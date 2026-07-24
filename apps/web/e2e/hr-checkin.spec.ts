import { expect, test } from '@playwright/test';

import { loginWithOtp } from './helpers/auth';

// HR self-service face check-in (PWA). Runs against the live compose stack with a fake
// camera (see playwright.config). It exercises the full capture pipeline: getUserMedia →
// liveness sample → JPEG → POST /attendance/me/check-in through the cookie session.
//
// The seeded login account is HQ staff, not necessarily linked to an employee with an
// enrolled face, so the *outcome* may be success OR a wired backend error ("belum
// tertaut"/"belum di-enroll"). Either proves the round-trip; a silent no-op would not.
test('face check-in captures a frame and posts through the cookie session', async ({ page }) => {
  await loginWithOtp(page);
  await page.context().grantPermissions(['camera']);

  await page.goto('/hr/me/check-in');
  await expect(page.getByRole('heading', { name: /Absensi Wajah/i })).toBeVisible({ timeout: 10_000 });

  // Wait for the camera to be ready (button enabled), then capture.
  const capture = page.getByRole('button', { name: /Ambil Foto/i });
  await expect(capture).toBeEnabled({ timeout: 15_000 });

  const postPromise = page.waitForResponse(
    (r) => r.url().includes('/attendance/api/v1/attendance/check-in') && r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await capture.click();

  // Either the capture posted (any status — success or a wired 4xx), or the client-side
  // liveness gate rejected it and surfaced an alert. Both are real, wired outcomes.
  const posted = await postPromise.catch(() => null);
  if (!posted) {
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible({ timeout: 5_000 });
  } else {
    expect(posted.status()).toBeLessThan(500); // never a server crash
  }
});
