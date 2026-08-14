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
  // The cooldown is OTP_RESEND_COOLDOWN_SECONDS (60 by default), not the couple of seconds the
  // old 4x2s budget assumed, so a spec that logged in right after another one always ran out of
  // retries. Read the countdown the form prints and wait exactly that long instead of guessing.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('button[type=submit]').click();
    try {
      await expect(page).toHaveURL(/\/verify\?/, { timeout: 5_000 });
      break;
    } catch {
      // The alert reads "Please wait 39s before requesting another code." / "Tunggu 39 detik…".
      const message = (await page.locator('body').innerText()).match(
        /(\d+)\s*(?:s\b|detik|seconds?)/i,
      );
      await page.waitForTimeout(message ? (Number(message[1]) + 2) * 1_000 : 5_000);
    }
  }
  await expect(page).toHaveURL(/\/verify\?/, { timeout: 10_000 });

  const code = await readLatestOtp(phone, 'LOGIN');
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code); // cascades across the segmented boxes, auto-submits on the 6th
  // Where sign-in LANDS is role-dependent now: `/verify` sends each account to
  // `consoleHome()` when no `next` was asked for, so a SUPER_ADMIN arrives at `/hq` and a
  // courier at `/driver`. This helper asserts only that the OTP was accepted and the
  // session exists; every spec navigates to the screen it is about anyway.
  await expect(page).not.toHaveURL(/\/(login|verify)/, { timeout: 15_000 });
}
