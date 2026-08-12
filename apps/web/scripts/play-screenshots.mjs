// Play listing screenshots for id.hydromart.ops, taken from the web app at the same phone
// viewport the customer set used (412x732 @3 = 1236x2196, mobile + touch) — Capacitor
// serves the same bundle, so what this captures is what the binary draws.
//
//   node scripts/play-screenshots.mjs
//
// Needs the local stack up and a way to read the login OTP back. The dev stack delivers
// OTPs over the `sms` channel, so point SMS_API_BASE_URL at a local sink that appends
// "<ts> <phone> <code>" lines to OTP_LOG, and set OTP_LOG here to that file.
import { readFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'g:/VsCode/Hydromart/docs/play-assets';

const PHONE = { viewport: { width: 412, height: 732 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const SHOTS = [
  { phone: '81100000003', route: '/driver', name: 'screenshot-ops-1-kurir' },
  { phone: '81100000003', route: '/hr/me', name: 'screenshot-ops-2-karyawan' },
  {
    phone: '81100000005',
    route: '/dashboard/walk-in',
    name: 'screenshot-ops-3-kasir',
    // The counter refuses sales until a shift owns the drawer, and that empty state is
    // what the listing would otherwise show. Open the shift, then shoot the till itself.
    async before(page) {
      const open = page.getByRole('button', { name: /Buka shift/i });
      if (await open.count()) {
        await open.first().click();
        await page.waitForTimeout(2500);
      }
      const plus = page.getByLabel('Increase quantity');
      if (await plus.count()) {
        await plus.nth(4).click();
        await plus.nth(4).click();
        await plus.nth(5).click();
      }
      // The "Shift dibuka." toast sits over the till for a few seconds.
      await page.waitForTimeout(6000);
    },
  },
  { phone: '81100000005', route: '/dashboard', name: 'screenshot-ops-4-ringkasan' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OTP_LOG = process.env.OTP_LOG ?? './otp.log';

function latestOtp(phone) {
  const target = `+62${phone}`;
  let out = '';
  try {
    out = readFileSync(OTP_LOG, 'utf8');
  } catch {
    return undefined;
  }
  let last;
  for (const line of out.trim().split('\n')) {
    const [, to, code] = line.split(' ');
    if (to === target) last = code;
  }
  return last;
}

async function login(page, phone) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('81234567890').fill(phone);
  const before = latestOtp(phone);
  for (let i = 0; i < 4; i++) {
    await page.locator('button[type=submit]').click();
    try {
      await page.waitForURL(/\/verify\?/, { timeout: 5000 });
      break;
    } catch {
      const m = (await page.locator('body').innerText()).match(/(\d+)\s*(?:s\b|detik|seconds?)/i);
      await sleep(m ? (Number(m[1]) + 2) * 1000 : 5000);
    }
  }
  let code;
  for (let i = 0; i < 20 && !code; i++) {
    const c = latestOtp(phone);
    if (c && c !== before) code = c;
    else await sleep(500);
  }
  if (!code) throw new Error(`no OTP for ${phone}`);
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code);
  await page.waitForURL((u) => !/\/verify/.test(u.pathname), { timeout: 15000 });
}

const browser = await chromium.launch();
for (const [phone, group] of Object.entries(
  SHOTS.reduce((a, s) => ((a[s.phone] ??= []).push(s), a), {}),
)) {
  const ctx = await browser.newContext({ ...devices['Pixel 5'], ...PHONE, locale: 'id-ID' });
  await ctx.addInitScript(() => {
    localStorage.setItem('hydromart.onboarded', '1');
    localStorage.setItem('hydromart_driver_onboarded', '1');
  });
  const page = await ctx.newPage();
  await login(page, phone);
  for (const s of group) {
    await page.goto(`${BASE}${s.route}`, { waitUntil: 'networkidle' });
    await sleep(2500);
    if (s.before) await s.before(page);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    console.log(`${s.name}.png  <- ${page.url()}`);
  }
  await ctx.close();
}
await browser.close();
