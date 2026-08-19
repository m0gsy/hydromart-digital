import { expect, test } from '@playwright/test';

import { loginWithOtp } from './helpers/auth';

// The OTP-gated journey smoke.spec deliberately skips: full login through the httpOnly
// cookie session (SEC-4), then a cookie-authenticated read + an authenticated cart
// write. Requires the compose stack up and seeded (see ci.yml e2e job): the seeded
// SUPER_ADMIN staff phone is a real, invited account, so its LOGIN OTP resolves.
//
// Checkout past the cart is NOT covered here: it is address-gated and the seed creates
// no customer delivery address / depot-coverage geocoding. That needs fulfilment seed
// state and belongs in its own spec once seeded.

test('OTP login establishes an authenticated cookie session', async ({ page }) => {
  await loginWithOtp(page);

  // Sign-in lands each role on its own console (`consoleHome()`) — this seeded account is
  // a SUPER_ADMIN, so it arrives at /hq. What this test is about is the session, not the
  // destination, so the shop is a deliberate navigation.
  await page.goto('/products');
  // The toast provider mounts an always-present empty role=alert live region, so assert
  // no alert carries actual error text rather than a zero count.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

  // The credential is an httpOnly cookie, unreadable by JS — assert it exists at the
  // browser-context level (this is what carries auth to the gateway now).
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === 'hm_at')).toBe(true);
});

test('a protected page loads over the cookie session', async ({ page }) => {
  await loginWithOtp(page);
  // Sign-in now lands each role on its own console (`consoleHome()`), and this seeded
  // account is a SUPER_ADMIN, so the shop is a deliberate navigation rather than where
  // the OTP left us.
  await page.goto('/products');

  // /account is auth-gated; reaching it without a bounce to /login proves the cookie
  // round-trips to the gateway and the authenticated /auth/me read succeeds.
  await page.goto('/account');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('an authenticated customer can add a seeded product to the cart', async ({ page }) => {
  await loginWithOtp(page);
  // Sign-in now lands each role on its own console (`consoleHome()`), and this seeded
  // account is a SUPER_ADMIN, so the shop is a deliberate navigation rather than where
  // the OTP left us.
  await page.goto('/products');

  // Seeded products carry valid v4 ids, so add-to-cart passes @IsUUID() (the DATA-1
  // failure was stale non-v4 live rows, never the seed). Add the first card's product.
  const addButton = page.getByRole('button', { name: /tambah|keranjang|add/i }).first();

  // Wait for the write itself, not for the click to return.
  //
  // The click fires an async POST and returns immediately; navigating on the next line
  // raced it, and when the POST lost, `/cart` was legitimately empty and the assertion
  // below failed with "element(s) not found" — a red run naming the cart page for a
  // defect in this test. Awaiting the response also turns the write into an assertion:
  // a 4xx/5xx now says so here rather than surfacing as a missing line item one
  // navigation later.
  const written = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/orders\/api\/v1\/cart\/items/.test(r.url()),
    { timeout: 15_000 },
  );
  await addButton.click();
  expect((await written).ok()).toBe(true);

  await page.goto('/cart');
  // A real line item rendered — the authenticated cart write + read both worked.
  await expect(page.getByText(/Rp\s?\d/).first()).toBeVisible({ timeout: 10_000 });
});
