import { expect, type Page } from '@playwright/test';

import { readLatestOtp } from './otp';

// Seeded SUPER_ADMIN staff phone — a real invited account, so its LOGIN OTP resolves
// (see scripts/seed.mjs + ci.yml e2e job). Overridable for a different seeded account.
export const E2E_PHONE = process.env.E2E_LOGIN_PHONE ?? '81100000001';

// Full OTP login through the httpOnly cookie session (SEC-4). Leaves the browser on
// /products with an authenticated cookie. Shared by authed.spec and checkout.spec.
export async function loginWithOtp(page: Page, phone = E2E_PHONE) {
  // Suppress the first-run onboarding tour — it mounts a fixed inset-0 overlay that
  // intercepts clicks on a fresh browser context (onboarding-tour.tsx, gated on this
  // localStorage flag). Must run before the first navigation.
  await page.addInitScript(() => localStorage.setItem('hydromart.onboarded', '1'));
  await page.goto('/login');
  await page.getByPlaceholder('81234567890').fill(phone);
  // The submit label is locale-driven ("Kirim kode" / "Send code"), so target the
  // form's only submit button by type rather than an accessible-name regex.
  //
  // Every spec logs in as the same seeded account, and auth-service enforces a resend
  // cooldown per (customer, purpose) — issue() throws OtpResendCooldownError while a
  // challenge is still active. Two specs starting within a second of each other leave the
  // second one sitting on /login with "Please wait Ns before requesting another code", so
  // retry rather than fail: the cooldown is seconds, not minutes.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.locator('button[type=submit]').click();
    try {
      await expect(page).toHaveURL(/\/verify\?/, { timeout: 5_000 });
      break;
    } catch {
      await page.waitForTimeout(2_000);
    }
  }
  await expect(page).toHaveURL(/\/verify\?/, { timeout: 10_000 });

  const code = await readLatestOtp(phone, 'LOGIN');
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code); // cascades across the segmented boxes, auto-submits on the 6th
  await expect(page).toHaveURL(/\/products/, { timeout: 15_000 });
}
