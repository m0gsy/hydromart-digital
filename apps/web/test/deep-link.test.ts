import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DYNAMIC_PARENTS, resolveDeepLink } from '@/lib/deep-link';

/**
 * F3b. The rewriting exists because F1 changed every dynamic route into a query
 * parameter while links in the old shape stayed in the world — on phones, in WhatsApp
 * threads, in bookmarks. In an exported build the old shape is not a stale page, it is a
 * file that does not exist, so getting this wrong is a blank screen with no error.
 */
describe('resolveDeepLink', () => {
  it('rewrites the old order route into the query-param one', () => {
    expect(resolveDeepLink('/orders/ord-1')).toBe('/orders/detail?id=ord-1');
  });

  it('rewrites a sub-page under an id, keeping the sub-page name', () => {
    expect(resolveDeepLink('/orders/ord-1/review')).toBe('/orders/detail/review?id=ord-1');
  });

  it('takes the path out of an App Link and drops the host', () => {
    expect(resolveDeepLink('https://hydromart.example/products/p-9')).toBe(
      '/products/detail?id=p-9',
    );
  });

  it('leaves a link that is already in the new shape alone', () => {
    expect(resolveDeepLink('/orders/detail?id=ord-1')).toBe('/orders/detail?id=ord-1');
  });

  it('leaves a static route alone', () => {
    expect(resolveDeepLink('/notifications')).toBe('/notifications');
    expect(resolveDeepLink('https://hydromart.example/rewards')).toBe('/rewards');
  });

  it('keeps any other query parameters the link carried', () => {
    expect(resolveDeepLink('/orders/ord-1?placed=1')).toBe('/orders/detail?id=ord-1&placed=1');
  });

  it('tolerates the trailing slash an exported build produces', () => {
    expect(resolveDeepLink('/orders/ord-1/')).toBe('/orders/detail?id=ord-1');
  });

  it('rewrites the deepest courier routes, which is where the ids actually hurt', () => {
    expect(resolveDeepLink('/driver/deliveries/d-1/success')).toBe(
      '/driver/deliveries/detail/success?id=d-1',
    );
  });

  it('escapes an id rather than letting it write its own query string', () => {
    expect(resolveDeepLink('/orders/a%20b')).toBe('/orders/detail?id=a%20b');
    expect(resolveDeepLink('/orders/a&b=c')).toBe('/orders/detail?id=a%26b%3Dc');
  });

  it('leaves a malformed escape as-is instead of throwing', () => {
    expect(resolveDeepLink('/orders/100%')).toBe('/orders/detail?id=100%25');
  });

  it('refuses anything that names another origin', () => {
    // An intent this app cannot verify must never decide what the WebView loads.
    expect(resolveDeepLink('//evil.example/orders/1')).toBeNull();
    expect(resolveDeepLink('not a url')).toBeNull();
    expect(resolveDeepLink('')).toBeNull();
  });

  it('does not mistake a page name for an id', () => {
    expect(resolveDeepLink('/orders/detail')).toBe('/orders/detail');
    expect(resolveDeepLink('/hr/employees/new')).toBe('/hr/employees/new');
  });

  it('leaves a parent route with no id below it alone', () => {
    expect(resolveDeepLink('/orders')).toBe('/orders');
    expect(resolveDeepLink('/orders/')).toBe('/orders');
  });
});

/**
 * The second blank screen, the one the rewriting cannot fix: a link naming a route this
 * binary never shipped. `scripts/build-mobile.mjs` writes the list from the paths it
 * actually prunes, so these strings are the shape it emits, not a guess at it.
 */
describe('routes this binary does not carry', () => {
  const CUSTOMER = ['/hq/*', '/hr/*', '/dashboard/*', '/driver/*', '/m/*', '/resellers/*'];
  // Ops keeps `/hr/me` and drops the console: a subtree per pruned folder, plus `/hr`
  // itself as an exact route because its `page.tsx` went and its `layout.tsx` stayed.
  const OPS = ['/hq/*', '/hr/employees/*', '/hr/payroll/*', '/hr'];

  it('sends a customer opening a courier link home, not to a blank screen', () => {
    expect(resolveDeepLink('/driver/deliveries/d-1', CUSTOMER)).toBe('/');
    expect(resolveDeepLink('/dashboard', CUSTOMER)).toBe('/');
  });

  it('still serves the routes that binary does carry', () => {
    expect(resolveDeepLink('/orders/ord-1', CUSTOMER)).toBe('/orders/detail?id=ord-1');
    expect(resolveDeepLink('/driver/deliveries/d-1', OPS)).toBe('/driver/deliveries/detail?id=d-1');
  });

  it('drops the HR console without taking /hr/me with it', () => {
    expect(resolveDeepLink('/hr', OPS)).toBe('/');
    expect(resolveDeepLink('/hr/payroll/p-1', OPS)).toBe('/');
    expect(resolveDeepLink('/hr/me/check-in', OPS)).toBe('/hr/me/check-in');
  });

  // A prefix is a path segment, never a string. `/mm` is not under `/m`.
  it('does not match a route that merely starts with the same letters', () => {
    expect(resolveDeepLink('/resellers-guide', CUSTOMER)).toBe('/resellers-guide');
    expect(resolveDeepLink('/hr-policy', OPS)).toBe('/hr-policy');
  });

  it('carries every route when nothing was pruned, which is the web build', () => {
    expect(resolveDeepLink('/driver/deliveries/d-1', [])).toBe('/driver/deliveries/detail?id=d-1');
  });
});

/**
 * The list of dynamic parents is a copy of one fact that lives in the filesystem: which
 * route folders have a `detail/` child. Kept by hand it drifted both ways at once — one
 * parent listed that has no `detail/` (every rewrite landed on a file that does not
 * exist) and five that do but were absent (navigated bare, which is a white screen on
 * `/hr/me/payroll/detail`). Neither was visible from inside `deep-link.ts`, so the check
 * lives here, where it can read the tree the list is supposed to mirror.
 */
describe('DYNAMIC_PARENTS mirrors the app tree', () => {
  const APP = join(__dirname, '..', 'src', 'app');

  /** Every folder under `app/` that has a `detail/` child, as a route path. */
  function parentsWithDetail(dir: string, route = ''): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name === 'detail') out.push(route);
      else out.push(...parentsWithDetail(join(dir, e.name), `${route}/${e.name}`));
    }
    return out;
  }

  it('lists exactly the routes that have a detail/ page, longest prefix first', () => {
    const onDisk = parentsWithDetail(APP).sort();
    expect([...DYNAMIC_PARENTS].sort()).toEqual(onDisk);
  });

  it('is ordered longest first, so no short prefix shadows a longer one', () => {
    const lengths = DYNAMIC_PARENTS.map((p) => p.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it('rewrites the two links the drift broke', () => {
    expect(resolveDeepLink('/hr/me/payroll/pay-1')).toBe('/hr/me/payroll/detail?id=pay-1');
    // No `detail/` under promotions: the id is a route segment, and must stay one.
    expect(resolveDeepLink('/dashboard/promotions/promo-1')).toBe('/dashboard/promotions/promo-1');
  });
});
