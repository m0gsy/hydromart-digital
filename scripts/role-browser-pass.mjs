// Per-role browser pass — the check nothing else in this repo performs: what a screen
// actually shows the person who owns it, at the widths that person actually holds.
//
//   node scripts/role-browser-pass.mjs <hq|operator|manager|courier|customer> [id|en|both]
//   ROUTES="/hq/staff /hq/audit" node scripts/role-browser-pass.mjs hq id   # narrow a run
//   WIDTHS=320,412 node scripts/role-browser-pass.mjs courier id            # narrow widths
//
// Needs an up local stack, the web app served on :3000 (`next start -p 3000` from
// apps/web — another port and the gateway's CORS allowlist rejects it; and after any
// `npx next build` that server MUST be restarted or every page serves a dead chunk),
// and the seeded staff phones in REVIEWER_PHONE (comma-separated) with REVIEWER_OTP_CODE.
//
// Traps this script exists to not repeat:
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
// 4. It ran at 1440x1000 only. `/m/*` and `/driver/*` are phone-only surfaces that had
//    never been seen at a phone width. Five widths now, measured in ONE page load per
//    route: nothing in this app branches on width in JS (only `prefers-color-scheme`
//    does), so resizing re-runs the CSS and re-measures honestly, at 1/5th the requests.
// 5. `KEY_RE` listed 9 namespaces by hand and there are 27 dictionary files. It was blind
//    to `driver`, `hq`, `shop`, `order`, `home`, `profile` — i.e. to every route this
//    sweep most needed to read. The list is now read off the dictionary directory.
import { chromium } from 'playwright';
import { readdirSync, writeFileSync } from 'node:fs';

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

// The 70 `/dashboard` pages the ops binary actually ships (counted off
// apps/web/mobile-out-ops, not from memory). The three `*/detail` routes are new here.
const OPS = R(`
/dashboard /dashboard/account /dashboard/approvals /dashboard/approvals/detail
/dashboard/audit /dashboard/broadcast /dashboard/campaigns /dashboard/cashbook
/dashboard/churn /dashboard/commission /dashboard/compare /dashboard/crm
/dashboard/customers /dashboard/customers/detail /dashboard/customers/import
/dashboard/depot-settings /dashboard/depots /dashboard/disputes /dashboard/earning-rules
/dashboard/expense-claims /dashboard/forecast /dashboard/franchise /dashboard/handover
/dashboard/huddle /dashboard/incidents /dashboard/inventory /dashboard/inventory/import
/dashboard/loyalty /dashboard/maintenance /dashboard/meter /dashboard/monthly-pnl
/dashboard/monthly-review /dashboard/notifications /dashboard/onboarding
/dashboard/operator-settings /dashboard/orders /dashboard/payment-recon
/dashboard/payments /dashboard/payout /dashboard/pricing /dashboard/pricing/import
/dashboard/products /dashboard/products/manage /dashboard/profile /dashboard/promotions
/dashboard/promotions/detail /dashboard/purchase-orders /dashboard/purchase-orders/detail
/dashboard/ratings /dashboard/recommendations /dashboard/redemptions /dashboard/referral
/dashboard/reports /dashboard/resellers/import /dashboard/returns /dashboard/roles
/dashboard/search /dashboard/settings /dashboard/settlements /dashboard/shift
/dashboard/staff /dashboard/subscriptions /dashboard/suppliers /dashboard/targets
/dashboard/team-performance /dashboard/tracking /dashboard/vouchers /dashboard/walk-in
/dashboard/wastage /dashboard/wholesale
`);

// All 8 `/m/manager` screens — including the two nobody had ever loaded.
const MANAGER = R(`
/m/manager /m/manager/account /m/manager/approvals /m/manager/approvals/detail
/m/manager/login /m/manager/notifications /m/manager/pricing /m/manager/team
`);

// 24 `/driver` + 8 `/hr/me` = the courier's whole half of the ops binary. The seven
// `/driver/deliveries/detail*` screens are the core of the job (pay, fail, no-show,
// reschedule, return, success) and had never been in this list.
const DRIVER = R(`
/driver /driver/announcements /driver/deliveries/detail /driver/deliveries/detail/fail
/driver/deliveries/detail/no-show /driver/deliveries/detail/pay
/driver/deliveries/detail/reschedule /driver/deliveries/detail/returns
/driver/deliveries/detail/success /driver/earnings /driver/expenses /driver/goal
/driver/help /driver/history /driver/incidents/new /driver/onboarding
/driver/performance /driver/profile /driver/route /driver/settings /driver/settlement
/driver/settlement/history /driver/shift/check-in /driver/shift/status
/hr/me /hr/me/announcements /hr/me/attendance /hr/me/check-in /hr/me/enroll
/hr/me/leave /hr/me/payroll /hr/me/payroll/detail
`);

// The 26 pages of the customer binary. `/resellers` ships only in the ops binary but is
// the same shop shell, so it rides along here rather than earning its own run.
const SHOP = R(`
/ /products /products/detail /cart /checkout /orders /orders/detail
/orders/detail/review /account /account/edit /addresses /favorites /notifications
/promo /referral /rewards /subscriptions /vouchers /resellers /help
/kebijakan-privasi /hapus-akun /waralaba /login /register /verify
`);

const ROLES = {
  hq: { phone: '+6281100000001', routes: HQ },
  operator: { phone: '+6281100000005', routes: OPS },
  manager: { phone: '+6281100000002', routes: MANAGER },
  courier: { phone: '+6281100000003', routes: DRIVER },
  customer: { phone: '+6281298765432', routes: SHOP },
};

/**
 * A detail screen with no `?id=` renders its empty state, which measures nothing. The id
 * is scraped from the list page that links to it rather than pinned to a seed row, so a
 * reseed does not silently turn this sweep back into an empty-state sweep. Key = the
 * detail path prefix; value = the page whose `<a href>`s carry the ids.
 */
const ID_SOURCE = {
  '/products/detail': '/products',
  '/orders/detail': '/orders',
  '/driver/deliveries/detail': '/driver',
  '/hr/me/payroll/detail': '/hr/me/payroll',
  '/m/manager/approvals/detail': '/m/manager/approvals',
  '/dashboard/approvals/detail': '/dashboard/approvals',
  '/dashboard/customers/detail': '/dashboard/customers',
  '/dashboard/purchase-orders/detail': '/dashboard/purchase-orders',
  '/dashboard/promotions/detail': '/dashboard/promotions',
};

/** The five widths this app is actually held at. Height matters only for the fold. */
const ALL_WIDTHS = [
  { w: 320, h: 568, why: 'floor the app supports — body clips here, it does not scroll' },
  { w: 360, h: 800, why: 'mid-range Android, most of the fleet' },
  { w: 390, h: 844, why: 'iPhone 14/15' },
  { w: 412, h: 915, why: 'Pixel 7 (the existing Playwright project)' },
  { w: 428, h: 926, why: 'phablet' },
];
const WIDTHS = process.env.WIDTHS
  ? ALL_WIDTHS.filter((v) => process.env.WIDTHS.split(',').includes(String(v.w)))
  : ALL_WIDTHS;

/** Touch-target floor. Anything smaller is a miss waiting to happen on a real thumb. */
const TAP_MIN = 44;

const roleName = process.argv[2];
const localeArg = process.argv[3] ?? 'both';
const role = ROLES[roleName];
if (!role) {
  console.error(`usage: node role-browser-pass.mjs <${Object.keys(ROLES).join('|')}> [id|en|both]`);
  process.exit(2);
}
const LOCALES = localeArg === 'both' ? ['id', 'en'] : [localeArg];
// Narrow a run to a few routes without editing the lists — how a single finding gets
// reproduced without paying for the whole sweep again.
const routes = process.env.ROUTES ? R(process.env.ROUTES) : role.routes;

/**
 * Namespaces read off the dictionary directory, not typed out. The hand-written list had
 * 9 of 27, so "zero printed keys" was a statement about a third of the app.
 * `locale-context.tsx:54` returns the KEY itself when a lookup misses, so a raw
 * `driver.route.title` on screen is the only evidence that a key is missing.
 */
const NAMESPACES = readdirSync('apps/web/src/lib/dictionaries/id')
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''));
const KEY_RE = new RegExp(
  `\\b(${NAMESPACES.join('|')})\\.[a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)*\\b`,
  'g',
);
/**
 * Two screens print dictionary-shaped text on purpose: `/hq/content` IS the dictionary
 * editor, and the audit logs render server event codes (`auth.login.succeeded`). Skipping
 * them by route beats weakening the pattern for every other screen.
 */
const KEY_EXEMPT = /^\/(hq\/content|hq\/audit|dashboard\/audit)$/;

// Not a bare `403`: an id or a phone number containing those digits made every screen
// look like a denial.
const DENIED_RE = /Akses ditolak|Access denied|tidak punya akses|not authorized|Khusus (staf|Manajer)/i;
// By URL, not by text: /hq/content renders the id dictionary, "Kirim kode" and the phone
// placeholder included, so a text match called it a sign-in wall and aborted the run.
const isLoginWall = (url, route) =>
  /\/(login|verify)/.test(new URL(url).pathname) && !/\/(login|verify)/.test(route);

const findings = [];
const note = (route, locale, kind, detail, width = null) =>
  findings.push({
    role: roleName,
    route,
    locale,
    width,
    kind,
    detail: String(detail).slice(0, 300),
  });

// ---------------------------------------------------------------------------
// The in-page measurement. Runs once per width, on an already-loaded page.
// ---------------------------------------------------------------------------
/* c8 ignore start — browser-side, never executed by node */
const MEASURE = ({ tapMin }) => {
  const sel = (el) => {
    if (!el) return 'null';
    const cls = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join('.');
    const txt = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 34);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const vw = document.documentElement.clientWidth;

  // --- 1. cut screens ------------------------------------------------------
  // The document-level guard, and — because that guard is blind to content a LOCAL
  // `overflow:hidden` box narrower than the viewport cuts off — every element measured
  // against its nearest clipping ancestor. That second check is the one that sees a hero
  // carousel eating a countdown row.
  // A hidden ancestor (`hidden md:flex`) leaves its children with a 0x0 rect and their
  // OWN computed display, so checking the element alone called every desktop-nav link a
  // zero-size button. `checkVisibility` asks the question that was actually meant.
  const visible = (el) =>
    el.checkVisibility
      ? el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
      : !!el.offsetParent;

  const docOver = Math.round(document.documentElement.scrollWidth - vw);
  // Naming the culprit, not just the symptom: the first element in each chain that runs
  // past the viewport while its own parent still fits. Without this, "150px wider than
  // 320" sends someone hunting through a whole page of divs.
  const docCulprits = [];
  if (docOver > 0) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
      const parent = el.parentElement;
      const pr = parent?.getBoundingClientRect();
      // The parent is already the offender — unless the parent is <body>, which overflows
      // BECAUSE of this element. Skipping that case reported nothing at all on a page
      // whose whole column was too wide.
      if (pr && pr.right > vw + 1 && parent !== document.body) continue;
      // Content inside a scroller or a clipped box cannot widen the document, however far
      // right it sits. Without this the tab strip of `/dashboard/reports` — which is in an
      // `overflow-x-auto` nav and behaving perfectly — was named as the culprit at
      // +1574px, and the element actually stretching the page went unmentioned.
      let a = el.parentElement;
      let contained = false;
      while (a && a !== document.documentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
          contained = true;
          break;
        }
        a = a.parentElement;
      }
      if (contained) continue;
      docCulprits.push({ el: sel(el), over: Math.round(r.right - vw) });
    }
    // Nothing named means every over-wide box was inside a scroller — yet the document is
    // still too wide, so something has a width rather than a position problem. Fall back
    // to the widest boxes on the page, which is the next question a human would ask.
    if (!docCulprits.length) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1 && r.height > 0)
          docCulprits.push({ el: `wide: ${sel(el)}`, over: Math.round(r.width - vw) });
      }
    }
    // Still nothing: name whatever reaches furthest right, contained or not. An empty
    // culprit list next to a real overflow number is the least useful thing this can say.
    if (!docCulprits.length) {
      const far = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && x.r.height > 0)
        .sort((a, b) => b.r.right - a.r.right)
        .slice(0, 3);
      for (const x of far)
        docCulprits.push({ el: `rightmost: ${sel(x.el)}`, over: Math.round(x.r.right - vw) });
    }
  }
  const clipped = new Map();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    let a = el.parentElement;
    let box = null;
    while (a && a !== document.body) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX;
      // `auto`/`scroll` before any hidden ancestor means the content is REACHABLE: the
      // scroller is what the outer `overflow-hidden` card clips, not the content. Reading
      // past it called every wide-table-in-a-card a cut — `/dashboard/inventory` has the
      // scroller one level under the card and was reported 473px cut at 320px.
      if (ox === 'auto' || ox === 'scroll') break;
      if (ox === 'hidden' || ox === 'clip') {
        // `truncate` is `overflow:hidden` + an ellipsis, i.e. a deliberate cut with a
        // visible marker. Not a defect, and it is on hundreds of rows.
        if (cs.textOverflow !== 'ellipsis') box = a;
        break;
      }
      a = a.parentElement;
    }
    if (!box) continue;
    const b = box.getBoundingClientRect();
    if (b.width === 0) continue;
    const over = Math.round(Math.max(r.right - b.right, b.left - r.left));
    if (over <= 2) continue;
    // A `pointer-events-none` absolute is a decorative blur that is SUPPOSED to run off
    // the edge of its card. Recorded, but flagged, so a real cut row is not buried under
    // three glows — and so the worst-per-box rule does not let a glow hide one.
    const decorative =
      getComputedStyle(el).pointerEvents === 'none' ||
      el.getAttribute('aria-hidden') === 'true' ||
      (el.textContent ?? '').trim() === '';
    const key = `${sel(box)}|${decorative ? 'deco' : 'content'}`;
    const prev = clipped.get(key);
    if (!prev || over > prev.over)
      clipped.set(key, {
        box: sel(box),
        boxW: Math.round(b.width),
        over,
        child: sel(el),
        decorative,
      });
  }

  // --- 2. tappable things --------------------------------------------------
  // Scrolled a viewport at a time, because `elementFromPoint` only answers about what is
  // on screen — and most of a page's buttons are below the fold.
  const tapBad = new Map();
  const seen = new Set();
  const recheck = [];
  const step = Math.max(200, Math.round(window.innerHeight * 0.85));
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  for (let y = 0; ; y += step) {
    window.scrollTo(0, Math.min(y, maxY));
    for (const el of document.querySelectorAll(
      'button, a, [role="button"], input[type="submit"], [role="tab"], summary',
    )) {
      if (!visible(el)) continue;
      if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') continue;
      const r = el.getBoundingClientRect();
      const key = sel(el);
      if (r.width === 0 || r.height === 0) {
        if (!tapBad.has(key)) tapBad.set(key, { el: key, kind: 'blocked', why: 'zero-size' });
        continue;
      }
      // Off-screen at this scroll position: another step will see it.
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
      const x = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Centre outside the viewport horizontally = a chip parked to the right of a
      // horizontal scroller. Clamping x into the viewport asked about a DIFFERENT chip
      // and reported every category filter as "covered by Galon Isi Ulang".
      if (x < 0 || x >= vw) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = document.elementFromPoint(x, cy);
      if (!hit) {
        recheck.push({ el, key, hit: 'nothing' });
      } else if (!el.contains(hit) && !hit.contains(el)) {
        // Something is on top of it AT THIS SCROLL POSITION — which for a fixed bottom
        // nav is true of nearly everything at some point in the scroll. Held for the
        // second pass below, which asks the only question that matters: is it still
        // covered once it has been scrolled into the middle of the screen?
        recheck.push({ el, key, hit: sel(hit) });
      } else if (r.width < tapMin || r.height < tapMin) {
        tapBad.set(key, {
          el: key,
          kind: 'small',
          w: Math.round(r.width),
          h: Math.round(r.height),
          why: `${Math.round(r.width)}x${Math.round(r.height)} < ${tapMin}`,
        });
      }
    }
    if (y >= maxY) break;
  }

  // Second pass: a thing is only unreachable if it is STILL covered after being scrolled
  // to the middle of the screen. Without this the fixed bottom nav "covers" every card
  // on every page, and the real cases — a header under a notch, a CTA the nav sits on
  // even at the end of the scroll — drown in 116 of them.
  for (const c of recheck) {
    c.el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = c.el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || x >= vw || y < 0 || y >= window.innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit) tapBad.set(c.key, { el: c.key, kind: 'blocked', why: 'center hits nothing' });
    else if (!c.el.contains(hit) && !hit.contains(c.el))
      tapBad.set(c.key, { el: c.key, kind: 'blocked', why: `covered by ${sel(hit)}` });
  }
  window.scrollTo(0, 0);

  return {
    docOver,
    docCulprits: docCulprits.sort((a, b) => b.over - a.over).slice(0, 4),
    vw,
    clipped: [...clipped.values()].sort((a, b) => b.over - a.over).slice(0, 8),
    tapCovered: [...tapBad.values()].filter((t) => t.kind === 'blocked').slice(0, 10),
    tapSmall: [...tapBad.values()].filter((t) => t.kind === 'small').slice(0, 10),
    tapTotal: seen.size,
  };
};
/* c8 ignore stop */

const browser = await chromium.launch();
// Login and id-scraping happen at a real phone width so the mobile shell is the one under
// test from the first click.
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
/**
 * First-run gates, pre-dismissed. `/driver` REDIRECTS to `/driver/onboarding` until its
 * flag is set, and the customer tour covers the shop shell — so without these two lines
 * a courier sweep measures the tour 32 times and finds zero links to scrape. Both screens
 * are still measured: they are routes in the list, visited directly.
 */
await ctx.addInitScript(() => {
  localStorage.setItem('hydromart.locale', 'id');
  localStorage.setItem('hydromart.onboarded', '1');
  localStorage.setItem('hydromart_driver_onboarded', '1');
});

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
console.log(`signed in as ${roleName} (${role.phone}) → ${new URL(page.url()).pathname}`);
await page.close();

// ---- resolve `?id=` for the detail screens ----------------------------------
// One extra load per list page, once for the whole run.
const idFor = {};
const needed = new Set();
for (const route of routes) {
  const prefix = Object.keys(ID_SOURCE)
    .filter((p) => route === p || route.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) needed.add(prefix);
}
for (const prefix of needed) {
  const parent = ID_SOURCE[prefix];
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + parent, { waitUntil: 'networkidle', timeout: 45_000 });
    await p.waitForTimeout(800);
    const id = await p.evaluate((pre) => {
      const a = [...document.querySelectorAll('a[href]')]
        .map((x) => x.getAttribute('href'))
        .find((h) => h && h.startsWith(pre + '?id='));
      return a ? new URLSearchParams(a.split('?')[1]).get('id') : null;
    }, prefix);
    if (id) idFor[prefix] = id;
    else note(parent, 'id', 'NO SAMPLE ROW', `no <a href="${prefix}?id=…"> on ${parent}`);
  } catch (e) {
    note(parent, 'id', 'NO SAMPLE ROW', e.message);
  } finally {
    await p.close();
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`sample ids: ${JSON.stringify(idFor)}`);

const urlFor = (route) => {
  const prefix = Object.keys(idFor)
    .filter((p) => route === p || route.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return BASE + route + (prefix ? `?id=${idFor[prefix]}` : '');
};

// ---- the pass ---------------------------------------------------------------
const idText = {};
const geometry = []; // one row per route per width, findings or not
let aborted = false;

for (const locale of LOCALES) {
  for (const route of routes) {
    const errors = [];
    const bad = [];
    let apiCalls = 0;
    const p = await ctx.newPage();
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('request', (r) => {
      if (/:8080\//.test(r.url())) apiCalls += 1;
    });
    p.on('response', (r) => {
      const s = r.status();
      if (s >= 400) bad.push(`${s} ${new URL(r.url()).pathname}`);
    });
    try {
      await p.addInitScript((l) => {
        localStorage.setItem('hydromart.locale', l);
        localStorage.setItem('hydromart.onboarded', '1');
        localStorage.setItem('hydromart_driver_onboarded', '1');
      }, locale);
      const res = await p.goto(urlFor(route), { waitUntil: 'networkidle', timeout: 45_000 });
      await p.waitForTimeout(400);
      const status = res?.status() ?? 0;
      const text = await p.evaluate(() => document.body?.innerText ?? '');

      if (isLoginWall(p.url(), route)) {
        note(route, locale, 'LOGIN WALL', 'session lost — findings after this are void');
        console.error(`\n!! login wall at ${route}; stopping`);
        await p.close();
        aborted = true;
        break;
      }
      if (status >= 400) note(route, locale, 'HTTP', status);
      if (!KEY_EXEMPT.test(route)) {
        const keys = [...new Set(text.match(KEY_RE) ?? [])];
        if (keys.length) note(route, locale, 'PRINTED KEY', keys.join(', '));
      }
      if (text.trim().length < 40) note(route, locale, 'EMPTY', `${text.trim().length} chars`);
      if (DENIED_RE.test(text)) note(route, locale, 'DENIED', text.trim().slice(0, 120));
      // A data screen that asks the gateway nothing is not wired to anything.
      if (apiCalls === 0) note(route, locale, 'NO API CALL', 'zero gateway requests');
      for (const b of [...new Set(bad)].slice(0, 3)) note(route, locale, 'REQUEST', b);
      for (const e of [...new Set(errors)].slice(0, 2)) {
        if (!/favicon|ResizeObserver|Download the React|hydration/i.test(e))
          note(route, locale, 'CONSOLE', e);
      }
      if (locale === 'id') idText[route] = text;
      else if (idText[route] && idText[route] === text)
        note(route, 'en', 'NOT TRANSLATED', 'identical to id');

      // --- geometry, one load, five widths ---------------------------------
      for (const { w, h } of WIDTHS) {
        await p.setViewportSize({ width: w, height: h });
        await p.waitForTimeout(250); // let the CSS settle before measuring it
        const m = await p.evaluate(MEASURE, { tapMin: TAP_MIN });
        geometry.push({ route, locale, width: w, ...m });
        if (m.docOver > 0)
          note(
            route,
            locale,
            'PAGE OVERFLOW',
            `document is ${m.docOver}px wider than ${w} — ${m.docCulprits
              .map((c) => `${c.el} (+${c.over})`)
              .join(' | ')}`,
            w,
          );
        for (const c of m.clipped)
          note(
            route,
            locale,
            c.decorative ? 'CLIPPED (decorative)' : 'CLIPPED',
            `${c.over}px past ${c.box} (${c.boxW}px) — ${c.child}`,
            w,
          );
        for (const t of m.tapCovered) note(route, locale, 'TAP BLOCKED', `${t.el} — ${t.why}`, w);
        for (const t of m.tapSmall) note(route, locale, 'TAP SMALL', `${t.el} — ${t.why}`, w);
      }
      await p.setViewportSize({ width: 412, height: 915 });
    } catch (e) {
      note(route, locale, 'THREW', e.message);
    } finally {
      if (!p.isClosed()) await p.close();
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000)); // 100 req/min per service; every page asks /auth/me
  }
  if (aborted) break;
  process.stdout.write(`\n[${locale} done]\n`);
}

await browser.close();

// ---- report -----------------------------------------------------------------
const total = routes.length * LOCALES.length;
console.log(`\n${roleName}: ${total} page loads × ${WIDTHS.length} widths — ${findings.length} findings`);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n### ${kind} (${list.length})`);
  for (const f of list.slice(0, 40))
    console.log(`  ${f.locale} ${f.width ? String(f.width).padStart(4) : '   -'}  ${f.route}  ${f.detail}`);
  if (list.length > 40) console.log(`  … ${list.length - 40} more`);
}

writeFileSync(`role-pass-${roleName}.json`, JSON.stringify(findings, null, 2));
// One file per width, as asked: a responsive defect is a fact about a width, and reading
// it means reading only that width's file.
for (const { w } of WIDTHS) {
  const at = findings.filter((f) => f.width === w || f.width === null);
  writeFileSync(
    `role-pass-${roleName}-${w}.json`,
    JSON.stringify({ role: roleName, width: w, findings: at }, null, 2),
  );
}
writeFileSync(`role-pass-${roleName}-geometry.json`, JSON.stringify(geometry, null, 2));
