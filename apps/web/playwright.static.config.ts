import { defineConfig, devices } from '@playwright/test';

/**
 * The exported-binary suite. Separate from playwright.config.ts because it is the
 * opposite kind of test: no backend at all, just the static files the APK will carry,
 * served the way Capacitor serves them.
 *
 * It answers one question `next build` cannot: do the exported paths resolve? A missing
 * `trailingSlash` produces `products.html` where the device looks for
 * `products/index.html`, and every hard load and deep link becomes a white screen with
 * nothing in any build log. This is a `webServer` block, unlike the other config, because
 * here there IS nothing else to boot.
 *
 * Which export it serves is the caller's choice, because the two binaries carry
 * different surfaces: `walk-in` and `hr/me` do not exist in the customer app, and
 * running one suite blind against both would go red for a reason that is not a bug.
 *
 *   npm run test:export:customer     # mobile-out-customer
 *   npm run test:export:ops          # mobile-out-ops
 *   npm run test:export              # mobile-out, the unpruned build
 */
const PORT = Number(process.env.EXPORT_PORT ?? 4180);
const DIR = process.env.EXPORT_DIR ?? 'mobile-out';

export default defineConfig({
  testDir: './e2e-static',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: `node scripts/serve-export.mjs ${DIR} ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    // Never on a per-surface run: reusing a server still serving the OTHER binary's
    // export would make the whole suite a lie.
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'export', use: { ...devices['Pixel 7'] } },
    // 4.21 — the narrowest screen this app is expected to work on. A Pixel 7 is 412px CSS
    // wide and hides every one of the failures this project exists to catch; 320×568 is a
    // Galaxy J2 / A03 Core, which is what a depot hands a new courier.
    //
    // Measured in the PR-0 spike, so this is not a guess about what it catches:
    // `body { overflow-x: hidden }` does NOT suppress `documentElement.scrollWidth`, so an
    // over-wide block (500/320), a flex row that refuses to shrink (400/320) and an
    // unbreakable token (374/320) all trip it. What it CANNOT see is content clipped by a
    // LOCAL `overflow:hidden` narrower than the viewport — the A1 product-card case — which
    // is why that one has its own test instead of relying on this.
    { name: 'export-320', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 568 } } },
  ],
});
