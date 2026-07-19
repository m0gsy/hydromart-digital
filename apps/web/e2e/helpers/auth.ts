import { expect, type Page } from '@playwright/test';

import { readLatestOtp } from './otp';

// Seeded SUPER_ADMIN staff phone — a real invited account, so its LOGIN OTP resolves
// (see scripts/seed.mjs + ci.yml e2e job). Overridable for a different seeded account.
export const E2E_PHONE = process.env.E2E_LOGIN_PHONE ?? '81100000001';

// Full OTP login through the httpOnly cookie session (SEC-4). Leaves the browser on
// /products with an authenticated cookie. Shared by authed.spec and checkout.spec.
export async function loginWithOtp(page: Page, phone = E2E_PHONE) {
  await page.goto('/login');
  await page.getByPlaceholder('81234567890').fill(phone);
  // The submit label is locale-driven ("Kirim kode" / "Send code"), so target the
  // form's only submit button by type rather than an accessible-name regex.
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/verify\?/, { timeout: 15_000 });

  const code = await readLatestOtp(phone, 'LOGIN');
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code); // cascades across the segmented boxes, auto-submits on the 6th
  await expect(page).toHaveURL(/\/products/, { timeout: 15_000 });
}
