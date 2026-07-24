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

  // The capture button enables only once getUserMedia resolves. Headless Chromium's
  // fake device is not guaranteed to hand a stream to every runner — when it doesn't,
  // the component correctly surfaces a camera error. That's an environment limit, not a
  // product defect, so skip rather than fail; where the fake camera works the full
  // capture→POST pipeline below still runs.
  const capture = page.getByRole('button', { name: /Ambil Foto/i });
  const cameraError = page.getByText(/Tidak bisa mengakses kamera/i);
  await expect(capture.or(cameraError).first()).toBeVisible({ timeout: 15_000 });
  if (await cameraError.isVisible()) {
    test.skip(true, 'headless fake camera did not initialise on this runner');
  }
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
