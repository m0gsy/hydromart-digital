// Per-role browser pass — the check nothing else in this repo performs: what a screen
// actually shows the person who owns it.
//
//   node scripts/role-browser-pass.mjs <hq|operator|manager|courier|customer> [id|en|both]
//   ROUTES="/hq/staff /hq/audit" node scripts/role-browser-pass.mjs hq id   # narrow a run
//
// Needs an up local stack, the web app served on :3000 (`next start -p 3000` from
// apps/web — another port and the gateway's CORS allowlist rejects it), and the seeded
// staff phones in REVIEWER_PHONE (comma-separated) with REVIEWER_OTP_CODE set.
//
// Three traps this script exists to not repeat:
//
// 1. The 2026-08-14 pass signed in as HR ONLY. Every depot-ops route answered 401/403, so
//    what got inspected was the access-denied state, not the screen. One role per run, and
//    the role owns the routes it is given.
// 2. An earlier version signed in with `ctx.request`. The cookie stayed in the API jar,
//    all 136 loads were the sign-in wall, and "zero keys leaked" measured nothing. Login
//    goes THROUGH THE UI, and the run aborts the moment a page bounces to a login route.
// 3. Every service rate-limits 100 requests/minute and every page asks /auth/me. A fast
//    crawl 429s itself and every screen after it looks broken — that is the 2026-08-01
//    "langganan error" ghost. Hence the 2s pace; do not lower it.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const CODE = process.env.CODE ?? '424242';

const R = (list) => list.trim().split(/\s+/);

const HQ = R(`
/hq /hq/access /hq/analytics /hq/api-keys /hq/applications /hq/audit /hq/broadcast
/hq/campaigns /hq/catalog /hq/churn /hq/compare /hq/content /hq/customers /hq/depots
/hq/exports /hq/flags /hq/forecast /hq/forms/commission /hq/forms/pricing-rule
/hq/forms/segment /hq/forms/voucher /hq/franchise /hq/fraud /hq/health /hq/hierarchy
/hq/incidents /hq/inventory /hq/invoice-template /hq/loyalty /hq/notifications
/hq/onboarding /hq/orders /hq/payments /hq/pdp /hq/pricing /hq/profile /hq/promotions
/hq/reconciliation /hq/refunds /hq/reports/export /hq/retention /hq/returns /hq/roster
/hq/scheduled-reports /hq/scorecard /hq/search /hq/security /hq/sitemap /hq/sla-policy
/hq/staff /hq/staff/import /hq/subscriptions /hq/tax /hq/tickets /hq/vouchers
/hq/webhooks /hq/wizard /hq/access/landing
`);

const OPS = R(`
/dashboard /dashboard/account /dashboard/approvals /dashboard/audit /dashboard/broadcast
/dashboard/campaigns /dashboard/cashbook /dashboard/churn /dashboard/commission
/dashboard/compare /dashboard/crm /dashboard/customers /dashboard/customers/import
/dashboard/depot-settings /dashboard/depots /dashboard/disputes /dashboard/earning-rules
/dashboard/expense-claims /dashboard/forecast /dashboard/handover /dashboard/huddle
/dashboard/incidents /dashboard/inventory /dashboard/inventory/import /dashboard/loyalty
/dashboard/maintenance /dashboard/meter /dashboard/monthly-pnl /dashboard/monthly-review
/dashboard/notifications /dashboard/onboarding /dashboard/operator-settings
/dashboard/orders /dashboard/payment-recon /dashboard/payments /dashboard/payout
/dashboard/pricing /dashboard/pricing/import /dashboard/products/manage /dashboard/profile
/dashboard/promotions /dashboard/purchase-orders /dashboard/ratings
/dashboard/recommendations /dashboard/redemptions /dashboard/referral /dashboard/reports
/dashboard/resellers/import /dashboard/returns /dashboard/roles /dashboard/search
/dashboard/settings /dashboard/settlements /dashboard/shift /dashboard/staff
/dashboard/subscriptions /dashboard/suppliers /dashboard/targets
/dashboard/team-performance /dashboard/tracking /dashboard/vouchers /dashboard/walk-in
/dashboard/wastage /dashboard/wholesale /dashboard/franchise
`);

const MANAGER = R(`
/dashboard /m/manager /m/manager/account /m/manager/approvals /m/manager/notifications
/m/manager/pricing /m/manager/team /dashboard/approvals /dashboard/staff
/dashboard/team-performance /dashboard/targets /dashboard/monthly-review
`);

const DRIVER = R(`
/driver /driver/announcements /driver/earnings /driver/expenses /driver/goal /driver/help
/driver/history /driver/incidents/new /driver/onboarding /driver/performance
/driver/profile /driver/route /driver/settings /driver/settlement
/driver/settlement/history /driver/shift/check-in /driver/shift/status /hr/me
/hr/me/attendance /hr/me/leave /hr/me/payroll /hr/me/announcements /hr/me/check-in
`);

const SHOP = R(`
/ /products /cart /checkout /orders /account /account/edit /addresses /favorites
/notifications /promo /referral /rewards /subscriptions /vouchers /resellers /help
/kebijakan-privasi /hapus-akun
`);

const ROLES = {
  hq: { phone: '+6281100000001', routes: HQ },
  operator: { phone: '+6281100000005', routes: OPS },
  manager: { phone: '+6281100000002', routes: MANAGER },
  courier: { phone: '+6281100000003', routes: DRIVER },
  customer: { phone: '+6281298765432', routes: SHOP },
};

const roleName = process.argv[2];
const localeArg = process.argv[3] ?? 'both';
const role = ROLES[roleName];
if (!role) {
  console.error(`usage: node role-pass.mjs <${Object.keys(ROLES).join('|')}> [id|en|both]`);
  process.exit(2);
}
const LOCALES = localeArg === 'both' ? ['id', 'en'] : [localeArg];
// Narrow a run to a few routes without editing the lists — how a single finding gets
// reproduced without paying for the whole sweep again.
const routes = process.env.ROUTES ? R(process.env.ROUTES) : role.routes;

// Namespaces only. `auth.login.succeeded` on /hq/audit is a server audit EVENT code, and
// /hq/content is a dictionary editor that prints every key on purpose.
const KEY_RE =
  /(hrFix|opsFix|hqFix|mgrFix|customerFix|courierFix|dashA|dashB|dashC)\.[a-zA-Z0-9_]+\.[A-Za-z0-9_.]+/g;
// Not a bare `403`: an id or a phone number containing those digits made every screen
// look like a denial.
const DENIED_RE = /Akses ditolak|Access denied|tidak punya akses|not authorized|Khusus (staf|Manajer)/i;
// By URL, not by text: /hq/content renders the id dictionary, "Kirim kode" and the phone
// placeholder included, so a text match called it a sign-in wall and aborted the run.
const isLoginWall = (url, route) => /\/(login|verify)/.test(new URL(url).pathname) && !/\/(login|verify)/.test(route);

const findings = [];
const note = (route, locale, kind, detail) =>
  findings.push({ role: roleName, route, locale, kind, detail: String(detail).slice(0, 240) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem('hydromart.locale', 'id'));

// ---- sign in through the UI -------------------------------------------------
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
// Location chooser sits over the shop shell and eats the first click.
await page
  .getByRole('button', { name: /nanti saja|lewati|tutup|skip|later/i })
  .first()
  .click({ timeout: 2500 })
  .catch(() => {});
const local = role.phone.replace('+62', '');
await page.fill('input#phone', local);
await page.locator('form button[type=submit]').first().click();
await page.waitForURL(/\/verify/, { timeout: 15_000 });
await page.locator('input').first().click();
await page.keyboard.type(CODE, { delay: 60 });
await page
  .locator('form button[type=submit]')
  .first()
  .click({ timeout: 3000 })
  .catch(() => {}); // auto-submits on the 6th digit
await page.waitForURL((u) => !/\/verify|\/login/.test(u.pathname), { timeout: 20_000 });
const me = await page.evaluate(() =>
  Object.keys(localStorage)
    .filter((k) => /session|user|auth/i.test(k))
    .map((k) => `${k}=${localStorage.getItem(k)}`)
    .join(' | '),
);
console.log(`signed in as ${roleName} (${role.phone}) → ${new URL(page.url()).pathname}`);
console.log(`session: ${me.slice(0, 200)}`);
await page.close();

// ---- the pass ---------------------------------------------------------------
const idText = {};
for (const locale of LOCALES) {
  for (const route of routes) {
    const errors = [];
    const p = await ctx.newPage();
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const bad = [];
    p.on('response', (r) => {
      const s = r.status();
      if (s >= 400) bad.push(`${s} ${new URL(r.url()).pathname}`);
    });
    try {
      await p.addInitScript((l) => localStorage.setItem('hydromart.locale', l), locale);
      const res = await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45_000 });
      await p.waitForTimeout(300);
      const status = res?.status() ?? 0;
      const text = await p.evaluate(() => document.body?.innerText ?? '');

      if (isLoginWall(p.url(), route)) {
        note(route, locale, 'LOGIN WALL', 'session lost — findings after this are void');
        console.error(`\n!! login wall at ${route}; stopping`);
        await p.close();
        break;
      }
      if (status >= 400) note(route, locale, 'HTTP', status);
      const keys = [...new Set(text.match(KEY_RE) ?? [])];
      if (keys.length) note(route, locale, 'PRINTED KEY', keys.join(', '));
      if (text.trim().length < 40) note(route, locale, 'EMPTY', `${text.trim().length} chars`);
      if (DENIED_RE.test(text)) note(route, locale, 'DENIED', text.trim().slice(0, 120));
      for (const b of [...new Set(bad)].slice(0, 3)) note(route, locale, 'REQUEST', b);
      for (const e of [...new Set(errors)].slice(0, 2)) {
        if (!/favicon|ResizeObserver|Download the React|hydration/i.test(e))
          note(route, locale, 'CONSOLE', e);
      }
      if (locale === 'id') idText[route] = text;
      else if (idText[route] && idText[route] === text)
        note(route, 'en', 'NOT TRANSLATED', 'identical to id');
    } catch (e) {
      note(route, locale, 'THREW', e.message);
    } finally {
      await p.close();
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000)); // 100 req/min per service, and every page asks /auth/me // the gateway rate-limits a fast crawl
  }
  process.stdout.write(`\n[${locale} done]\n`);
}

await browser.close();
const total = routes.length * LOCALES.length;
console.log(`\n${roleName}: ${total} page loads — ${findings.length} findings`);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n### ${kind} (${list.length})`);
  for (const f of list.slice(0, 40)) console.log(`  ${f.locale}  ${f.route}  ${f.detail}`);
  if (list.length > 40) console.log(`  … ${list.length - 40} more`);
}
writeFileSync(`role-pass-${roleName}.json`, JSON.stringify(findings, null, 2));
