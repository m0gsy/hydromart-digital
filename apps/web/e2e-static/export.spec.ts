import { expect, test } from '@playwright/test';

// The exported site, served the way the APK will serve it, with NO backend behind it.
// Data calls fail here on purpose — a courier opening the app in a dead spot is exactly
// that situation, and the shell still has to render. So every assertion below is about
// the shell: did the file resolve, did React mount, did the chrome paint.
//
// EXPORT_SURFACE says which binary's export is being served, because the two carry
// different route sets and a customer app that also shipped /dashboard would be a
// failure, not a pass.

type Surface = 'full' | 'customer' | 'ops';
const SURFACE = (process.env.EXPORT_SURFACE ?? 'full') as Surface;

/** Hard loads — the case a wrapper pointed at a live URL cannot survive at all. */
const CUSTOMER_PATHS = [
  '/',
  '/products/',
  '/login/',
  '/account/',
  '/hapus-akun/',
  '/kebijakan-privasi/',
  // Routes that used to be dynamic segments: no file existed for these at all before.
  '/orders/detail/?id=ord_1',
  '/orders/detail/review/?id=ord_1',
  '/products/detail/?id=prod_1',
];

const OPS_PATHS = [
  '/driver/',
  '/dashboard/',
  '/hr/me/check-in/',
  '/dashboard/walk-in/',
  '/driver/deliveries/detail/?id=dlv_1',
  '/driver/deliveries/detail/pay/?id=dlv_1',
  '/hq/depots/detail/?id=dep_1',
  '/m/manager/approvals/detail/?id=apr_1',
];

/** What this binary must NOT carry — the other app's console, shipped by accident. */
const WITHHELD: Record<Surface, string[]> = {
  full: [],
  customer: ['/dashboard/', '/driver/', '/hr/me/check-in/', '/hq/', '/resellers/'],
  ops: ['/hq/', '/hr/payroll/', '/hr/employees/'],
};

const SERVED: Record<Surface, string[]> = {
  full: [...CUSTOMER_PATHS, ...OPS_PATHS],
  customer: CUSTOMER_PATHS,
  // The ops binary keeps the customer shop too — a depot manager is still a signed-in
  // user with an account screen — minus /hq, which is head office and desktop-first.
  ops: [...CUSTOMER_PATHS, ...OPS_PATHS.filter((p) => !p.startsWith('/hq'))],
};

for (const path of SERVED[SURFACE]) {
  test(`serves ${path}`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status(), `${path} must resolve to an exported file`).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });
}

for (const path of WITHHELD[SURFACE]) {
  test(`does not ship ${path}`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status(), `${path} must have been pruned from the ${SURFACE} binary`).toBe(404);
  });
}

test('J2: a path without its trailing slash still resolves', async ({ page }) => {
  // Capacitor looks for `<path>/index.html` and never for `<path>.html`. This is the
  // shape the whole `trailingSlash: true` decision exists to produce, and the failure
  // it prevents — a white screen on every hard load — is silent in `next build`.
  const res = await page.goto('/products');
  expect(res?.status()).toBe(200);
});

test('the query param reaches the page, not just the file', async ({ page }) => {
  // Resolving the file proves the export. This proves the other half — that the id
  // survives the trip and the page acts on it, which is the whole job the route segment
  // used to do. Product detail rather than order detail: the pages behind RequireAuth
  // redirect to /login with no session, so they never get as far as asking for anything.
  // The request fails (there is no backend); what matters is that it was made, and made
  // for the right id.
  const asked: string[] = [];
  page.on('request', (request) => asked.push(request.url()));

  await page.goto('/products/detail/?id=prod_from_query');

  await expect
    .poll(() => asked.some((url) => url.includes('/products/api/v1/products/prod_from_query')), {
      timeout: 15_000,
    })
    .toBe(true);

  // And never for an empty one. `useQueryParam` hands the real value to the FIRST render;
  // if it ever went back to reporting '' during hydration, useAsync would fire this
  // request against no id on every page load in the app.
  expect(asked.filter((url) => /\/products\/api\/v1\/products\/?(\?|$)/.test(url))).toEqual([]);
});

test('the shell paints without a backend', async ({ page }) => {
  await page.goto('/products/');
  // Font, theme tokens and chrome all come from the bundle, so they must survive with
  // every network call failing.
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.locator('body')).not.toBeEmpty();
});

test('the icons sw.js points at are actually in the bundle', async ({ request }) => {
  for (const asset of [
    '/icon-192.png',
    '/icon-512.png',
    '/icon-maskable-512.png',
    '/manifest.webmanifest',
  ]) {
    expect((await request.get(asset)).status(), `${asset} must ship`).toBe(200);
  }
});

/**
 * 4.21 — nothing may overflow the narrowest screen this app supports.
 *
 * `body { overflow-x: hidden }` (layout.tsx) means an over-wide element does not produce a
 * scrollbar: it is simply CUT OFF, silently, with no console warning and nothing to notice
 * on a 412px test device. The PR-0 spike measured what that does and does not hide —
 * `documentElement.scrollWidth` still grows for content the viewport clips, so this guard
 * really does fire for an over-wide block, a non-shrinking flex row and an unbreakable
 * token. It is blind only to content clipped by a local `overflow:hidden` ancestor that is
 * itself narrower than the viewport.
 *
 * An `overflow-x: auto` ancestor is the sanctioned escape — a wide table that the user can
 * scroll is a decision, not a defect — so anything inside one is skipped.
 */
for (const path of SERVED[SURFACE]) {
  test(`fits 320px: ${path}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'export-320', 'the 320px project only');
    await page.goto(path);
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      const over = de.scrollWidth - de.clientWidth;
      if (over <= 1) return null;
      let worst: { right: number; tag: string; cls: string } | null = null;
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= de.clientWidth + 1) continue;
        let scrollable = false;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'auto' || ox === 'scroll') {
            scrollable = true;
            break;
          }
        }
        if (scrollable) continue;
        if (!worst || r.right > worst.right) {
          worst = {
            right: Math.round(r.right),
            tag: el.tagName.toLowerCase(),
            cls: String(el.className ?? '').slice(0, 120),
          };
        }
      }
      return { over, worst };
    });
    // Named, not just counted: "something is 40px too wide" sends the next person hunting
    // through the whole page, and this guard runs on screens nobody has open.
    expect(
      overflow,
      overflow
        ? `${path} overflows 320px by ${overflow.over}px — widest: ${overflow.worst?.tag}.${overflow.worst?.cls}`
        : '',
    ).toBeNull();
  });
}
