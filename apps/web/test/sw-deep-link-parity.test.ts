import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DYNAMIC_PARENTS, NOT_AN_ID, WEB_TWINS, resolveDeepLink, webTwin } from '@/lib/deep-link';

/**
 * K5.5. Two tap handlers, one payload, two behaviours.
 *
 * `lib/deep-link.ts` exists because F1 turned every dynamic segment into a query
 * parameter, and links in the old shape are still in the world — notifications already
 * sitting on phones, WhatsApp messages, bookmarks. The two NATIVE handlers route through
 * it. `public/sw.js` — the tap handler for every browser and installed PWA — did not
 * rewrite anything at all, so the same notification opened the order on Android and a
 * route that no longer exists in a browser.
 *
 * A service worker cannot import a TypeScript module, so sw.js carries its own copy of
 * the two lists. This file is what stops that copy being the usual kind: it compares the
 * lists directly, and then compares BEHAVIOUR over a table generated from those same
 * lists, so a rewrite that drifts in either direction fails here.
 */

const SW_SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

/** Pulls the sw's `rewriteLegacyPath` out of a file that is not a module. */
function swRewrite(): (raw: string) => string {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    'self',
    `${SW_SRC}\nreturn rewriteLegacyPath;`,
  )({ addEventListener: () => {}, location: { origin: 'https://app.test' } }) as (
    raw: string,
  ) => string;
}

/** Reads an array literal (of strings) out of the service-worker source. */
function swList(name: string): string[] {
  const match = SW_SRC.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  expect(match, `${name} not found in sw.js`).toBeTruthy();
  return [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('K5.5 · sw.js and deep-link.ts agree', () => {
  it('carries the same dynamic parents, in the same order', () => {
    // Order matters in both copies: longest first, so `/dashboard/approvals` is tested
    // before anything shorter could shadow it.
    expect(swList('DYNAMIC_PARENTS')).toEqual([...DYNAMIC_PARENTS]);
  });

  // Flow 6a: a browser push opens a phone-console destination on its desktop twin, exactly as
  // the desktop feed does (notificationHref with desk).
  it('carries the same web twins, and twins a browser push as the desktop feed does', () => {
    const twins = new Function('self', `${SW_SRC}\nreturn WEB_TWINS;`)({
      addEventListener: () => {},
      location: { origin: 'https://app.test' },
    }) as [string, string][];
    expect(twins).toEqual(WEB_TWINS.map(([a, b]) => [a, b]));
    const rewrite = swRewrite();
    for (const raw of [
      '/m/manager/approvals/detail?id=a-1',
      '/m/manager/approvals',
      '/m/manager/approvals/a-1',
      '/m/manager/approvalsx',
    ]) {
      expect(rewrite(raw), raw).toBe(resolveDeepLink(webTwin(raw)));
    }
  });

  it('carries the same not-an-id segments', () => {
    expect(swList('NOT_AN_ID').sort()).toEqual([...NOT_AN_ID].sort());
  });

  it('rewrites every parent exactly as the app does', () => {
    const rewrite = swRewrite();
    for (const parent of DYNAMIC_PARENTS) {
      const raw = `${parent}/abc-123`;
      // sw.js runs only in a browser, so it applies the desktop twin a notification gets there.
      expect(rewrite(raw), raw).toBe(resolveDeepLink(webTwin(raw)));
    }
  });

  it('agrees on sub-pages, queries, encoding and the segments that are not ids', () => {
    const rewrite = swRewrite();
    const cases = [
      '/orders/abc-123',
      '/orders/abc-123/review',
      '/orders/abc%20123',
      '/orders/abc-123?from=push',
      // Already in the new shape — must come back untouched, not rewritten twice.
      '/orders/detail?id=abc-123',
      // A page in its own right under a dynamic parent, not an id.
      '/orders/new',
      '/hr/employees/import',
      '/hq/depots/settings',
      // Not a dynamic parent at all.
      '/notifications',
      '/rewards',
      '/',
    ];
    for (const raw of cases) {
      expect(rewrite(raw), raw).toBe(resolveDeepLink(webTwin(raw)));
    }
  });

  /*
   * The one place they are ALLOWED to differ, stated rather than discovered: pruning is
   * what a mobile binary does to its own route table, and sw.js only ever runs in a
   * browser serving the whole site. `resolveDeepLink` takes the prune list as a parameter,
   * so the parity cases above all run with it empty.
   */
  it('does not prune, because a browser serves every route', () => {
    expect(swRewrite()('/driver/deliveries/d-1')).toBe('/driver/deliveries/detail?id=d-1');
    expect(resolveDeepLink('/driver/deliveries/d-1', ['/driver/*'])).toBe('/');
  });
});
