// Role gate pass — offline: the built web app against a MOCKED API.
//
//   cd apps/web && npx next build && npx next start -p 3000   # in another shell
//   node scripts/role-gate-pass.mjs [role ...]
//
// What it answers: for a given role, is every door the console DRAWS a door that opens?
// It signs in as the role by answering `/auth/me`, reads the links the rail and bottom nav
// render, opens each one and fails on an access-denied screen or the global error screen.
//
// What it does NOT answer: anything that depends on data or on the server's own answer
// (that is `role-browser-pass.mjs`, which needs the whole stack). Every other API call is
// answered with an empty page, so a screen that needs rows renders its empty state — which
// is enough to prove the gate let the role in, and nothing more.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const API = process.env.API ?? 'http://localhost:8080';
const DEPOT = '11111111-1111-4111-8111-111111111111';

const ROLES = {
  DIREKTUR: { depot: false },
  HEAD_OFFICE: { depot: false },
  FINANCE: { depot: false },
  MARKETING: { depot: false },
  MANAGER: { depot: true },
  KEPALA_DEPOT: { depot: true },
};
const wanted = process.argv.slice(2);
const roles = Object.keys(ROLES).filter((r) => wanted.length === 0 || wanted.includes(r));

// A refused door is a FAIL. The global error screen is only a WARN: with every endpoint
// answering an empty page, a screen that expects fields crashes on its own data, which says
// nothing about whether the gate let the role in.
const DENIED = [/Khusus HQ/i, /Akses ditolak/i, /Access denied/i, /Hanya untuk/i];
const CRASHED = [/Ada yang tidak beres/i, /Something went wrong/i];

function me(role) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    phone: '+6281100000099',
    email: null,
    fullName: `Uji ${role}`,
    role,
    status: 'ACTIVE',
    avatarUrl: null,
    assignedDepotId: ROLES[role].depot ? DEPOT : null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const empty = { items: [], total: 0, page: 1, limit: 20 };
const DEPOT_ROW = {
  id: DEPOT,
  code: 'D1',
  name: 'Depot Satu',
  city: 'Jakarta',
  province: 'DKI',
  active: true,
  lat: -6.2,
  lng: 106.8,
  ownershipType: 'HKP',
};

async function newPage(browser, role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/auth/me')) return json(me(role));
    // The depot switcher reads the caller's scope as a bare array.
    if (url.pathname.endsWith('/depots/api/v1/depots/scope')) return json([DEPOT_ROW]);
    if (url.pathname.includes('/depots/api/v1/depots'))
      return json({ ...empty, items: [DEPOT_ROW], total: 1 });
    // Paged reads carry `limit`/`page`; the rest of the console's reads are bare arrays.
    return json(/[?&](limit|page)=/.test(url.search) ? empty : []);
  });
  // The profile cache is what the console reads before any request goes out (session-store).
  await ctx.addInitScript(
    (session) => {
      window.localStorage.setItem('hm.session', JSON.stringify(session));
    },
    { customer: me(role) },
  );
  const page = await ctx.newPage();
  return { ctx, page };
}

const results = [];
const browser = await chromium.launch();
for (const role of roles) {
  const { ctx, page } = await newPage(browser, role);
  const start =
    role === 'MANAGER' || role === 'KEPALA_DEPOT'
      ? '/dashboard/search'
      : role === 'MARKETING'
        ? '/dashboard/campaigns'
        : '/hq/search';
  await page.goto(`${BASE}${start}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const links = await page.$$eval('nav a[href], aside a[href]', (as) =>
    [...new Set(as.map((a) => a.getAttribute('href')))].filter((h) => h && h.startsWith('/')),
  );
  const doors = links.filter((h) => /^\/(hq|dashboard|hr|resellers|m)(\/|$)/.test(h));
  console.log(`\n${role}: ${doors.length} door(s) drawn from ${start}`);
  for (const href of doors) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText);
    const bad = DENIED.find((re) => re.test(text));
    const ok = !bad && page.url().includes(href.split('?')[0]);
    const warn = ok && CRASHED.some((re) => re.test(text));
    results.push({
      role,
      href,
      ok,
      why: bad ? String(bad) : ok ? '' : `landed on ${new URL(page.url()).pathname}`,
    });
    console.log(
      `  ${ok ? (warn ? 'warn' : 'ok  ') : 'FAIL'} ${href}${ok ? (warn ? '  (data-shape crash on empty mock)' : '') : `  <- ${results.at(-1).why}`}`,
    );
  }
  if (role === 'MANAGER') {
    // Opening and closing a depot is head office's (`depotLifecycle`): a manager still sees
    // the depot they run and may edit it, but is offered neither of these controls.
    await page
      .goto(`${BASE}/dashboard/depots`, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined);
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const offered = [/Depot baru/i, /Nonaktifkan/i].filter((re) => re.test(text));
    const ok = offered.length === 0 && /Depot Satu/.test(text);
    results.push({
      role,
      href: '/dashboard/depots (controls)',
      ok,
      why: offered.map(String).join(','),
    });
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} /dashboard/depots offers no create/deactivate to a manager`,
    );
  }
  await ctx.close();
}
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length} door(s) opened across ${roles.length} role(s); ${failed.length} failed.`,
);
process.exit(failed.length ? 1 : 0);
