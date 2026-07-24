import { defineConfig, devices } from '@playwright/test';

// E2E against a running stack. Point BASE_URL at the web app (default the local
// `next dev`/compose web container on :3000). Playwright never boots the backend
// — the microservice stack must already be up (docker compose up -d).
//
// ponytail: no `webServer` block. Wiring Playwright to boot just the Next app
// would give it a frontend with no gateway/services behind it — every data call
// 404s and the E2E is a lie. CI brings the whole compose up first, then runs this.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Serial, single worker, no retries: the authed journeys all log in with the same
  // seeded phone, so parallel/retried runs stampede the auth-service OTP throttler +
  // per-phone resend cooldown (429 → no OTP sent → log scrape finds nothing).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Fake camera (a moving test pattern) so the HR face-capture / check-in flow can
        // run headless without a real webcam. The pattern moves → passes the liveness gate.
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
});
