import { expect, test } from '@playwright/test';

import { loginWithOtp } from './helpers/auth';

// Authed checkout end-to-end: OTP login → add a seeded product → place the order via
// the MANUAL address entry. This path needs NO fulfilment seed — the checkout page's
// manual-address flow supplies no coordinates, so order-service routing is fail-OPEN
// (order.service.ts): the order is placed with the flat delivery fee, no depot-coverage
// geocoding required. Requires the compose stack up + seeded catalog (ci.yml e2e job).
//
// The depot-ROUTED variant (coords within a seeded depot's radius → per-depot pricing,
// OutOfServiceAreaError on a miss) is deliberately not covered here: it needs a saved
// address carrying lat/lng, which only comes from the address book — seed it or POST it
// in-test first. Left out until fulfilment seed state exists.

test('an authenticated customer can place an order through manual checkout', async ({ page }) => {
  await loginWithOtp(page);

  // Add the first seeded product to the cart (seeded ids are valid v4 UUIDs). Wait for
  // the cart write to land before navigating, else /checkout can read an empty cart.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/cart/items') && r.request().method() === 'POST' && r.ok()),
    page.getByRole('button', { name: /tambah|keranjang|add/i }).first().click(),
  ]);

  await page.goto('/checkout');

  // No saved addresses on this account → the manual entry form is shown. Fill the
  // required fields by their stable input ids (labels are locale-driven).
  await page.locator('#recipientName').fill('Budi Santoso');
  await page.locator('#phone').fill('081234567890');
  await page.locator('#addressLine').fill('Jl. Merdeka No. 10, RT 01/RW 02');
  await page.locator('#city').fill('Jakarta Pusat');
  await page.locator('#province').fill('DKI Jakarta');

  // CASH is the default payment method. Submit places the order and redirects to the
  // order page with the one-time success banner (?placed=1).
  await page.locator('button[type=submit]').click();

  await expect(page).toHaveURL(/\/orders\/[^/?]+\?placed=1/, { timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});
