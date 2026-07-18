import { expect, test } from '@playwright/test';

import { readLatestOtp } from './helpers/otp';

// The OTP-gated journey smoke.spec deliberately skips: full login through the httpOnly
// cookie session (SEC-4), then a cookie-authenticated read + an authenticated cart
// write. Requires the compose stack up and seeded (see ci.yml e2e job): the seeded
// SUPER_ADMIN staff phone is a real, invited account, so its LOGIN OTP resolves.
//
// Checkout past the cart is NOT covered here: it is address-gated and the seed creates
// no customer delivery address / depot-coverage geocoding. That needs fulfilment seed
// state and belongs in its own spec once seeded.

const PHONE = process.env.E2E_LOGIN_PHONE ?? '81100000001'; // seeded SUPER_ADMIN

async function loginWithOtp(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByPlaceholder('81234567890').fill(PHONE);
  await page.getByRole('button', { name: /masuk|lanjut|kirim|sign in|continue/i }).first().click();
  await expect(page).toHaveURL(/\/verify\?/, { timeout: 15_000 });

  const code = await readLatestOtp(PHONE, 'LOGIN');
  // Focus the first OTP box; typing the whole string cascades across the segmented
  // inputs and auto-submits on the 6th digit (OtpInput.onComplete).
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code);
}

test('OTP login establishes an authenticated cookie session', async ({ page }) => {
  await loginWithOtp(page);

  // On success verify() calls router.replace(next) — default /products — and no error.
  await expect(page).toHaveURL(/\/products/, { timeout: 15_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The credential is an httpOnly cookie, unreadable by JS — assert it exists at the
  // browser-context level (this is what carries auth to the gateway now).
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === 'hm_at')).toBe(true);
});

test('a protected page loads over the cookie session', async ({ page }) => {
  await loginWithOtp(page);
  await expect(page).toHaveURL(/\/products/, { timeout: 15_000 });

  // /account is auth-gated; reaching it without a bounce to /login proves the cookie
  // round-trips to the gateway and the authenticated /auth/me read succeeds.
  await page.goto('/account');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('an authenticated customer can add a seeded product to the cart', async ({ page }) => {
  await loginWithOtp(page);
  await expect(page).toHaveURL(/\/products/, { timeout: 15_000 });

  // Seeded products carry valid v4 ids, so add-to-cart passes @IsUUID() (the DATA-1
  // failure was stale non-v4 live rows, never the seed). Add the first card's product.
  const addButton = page.getByRole('button', { name: /tambah|keranjang|add/i }).first();
  await addButton.click();

  await page.goto('/cart');
  // A real line item rendered — the authenticated cart write + read both worked.
  await expect(page.getByText(/Rp\s?\d/).first()).toBeVisible({ timeout: 10_000 });
});
