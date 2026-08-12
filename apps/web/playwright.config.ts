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
  // A spec that has to sit out the 60s OTP resend cooldown before it can even log in cannot fit
  // in the 30s default. Everything else finishes in seconds; this only raises the ceiling.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Every context starts as a returning user, past the first-run tour.
    //
    // The tour is a `fixed inset-0` overlay that shows whenever `hydromart.onboarded` is
    // absent — which is every fresh Playwright context. It was only ever invisible to these
    // tests because it lacked `aria-modal`: `getByRole` reads the accessibility tree, and
    // without that attribute the page behind a modal is still in it. The moment the tour
    // was made a proper modal (E10 — a back press has to close it), every `getByRole` in
    // every spec started resolving to nothing, and the specs that guard their steps with
    // `if (await x.isVisible())` skipped those steps SILENTLY and failed later somewhere
    // else entirely. `walk-in.spec` reported `ORDER_NO_OPEN_SHIFT` from the server.
    //
    // So this is not a workaround for the tour: it is the state a test means when it says
    // "a cashier opens the counter screen". A first-run tour is its own scenario, and
    // `test/onboarding-tour.test.tsx` is where it is tested.
    storageState: {
      cookies: [],
      origins: [
        { origin: BASE_URL, localStorage: [{ name: 'hydromart.onboarded', value: '1' }] },
      ],
    },
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
