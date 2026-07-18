import { expect, test } from '@playwright/test';

// Smoke coverage of the public, no-OTP paths — the flows that break loudest on a
// bad deploy (routing, SSR, the API client reaching the gateway). The OTP-gated
// authenticated journey is deliberately out of scope here: it needs a seeded
// phone + a way to read the dev OTP, which belongs in a separate authed spec.

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Hydromart/i);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('catalog page loads its shell', async ({ page }) => {
  const res = await page.goto('/products');
  expect(res?.status()).toBeLessThan(400);
  // SSR rendered a real heading — the route mounted, didn't error-boundary.
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('login submits a phone and routes to OTP verify', async ({ page }) => {
  await page.goto('/login');
  const phone = page.getByPlaceholder('81234567890');
  await expect(phone).toBeVisible();
  await phone.fill('81100000001');
  await phone.press('Enter'); // submit the form itself, not whatever button is first in the DOM
  // Success = the client posted the OTP challenge and navigated to /verify.
  // (A backend failure keeps us on /login with an inline error — this asserts the
  // gateway → auth-service round-trip actually worked.)
  await expect(page).toHaveURL(/\/verify\?/, { timeout: 15_000 });
});
