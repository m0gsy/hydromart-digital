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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
