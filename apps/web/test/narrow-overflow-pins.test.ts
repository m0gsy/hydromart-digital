import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * Five pages were wider than a 320px phone (the 2026-11-18 role pass; three also at 360).
 * jsdom has no layout, so these pin the one class each fix rests on, the way
 * `location-selector-shrinks.test.ts` pins the app bar's. Each was measured in Chromium at
 * 320px, ancestor chain by ancestor chain, before and after.
 */
const read = (file: string) => readFileSync(join(__dirname, '../src/app', file), 'utf8');

describe('pages that fit a 320px screen', () => {
  it('/hq/inventory: one minmax(0,1fr) column, not an auto column as wide as a depot name (+12px)', () => {
    expect(read('hq/inventory/page.tsx')).toMatch(
      /className="grid grid-cols-1 gap-3 sm:grid-cols-2"/,
    );
  });

  it('/account: one minmax(0,1fr) column below lg, not an auto column as wide as the profile name (+2px)', () => {
    expect(read('account/page.tsx')).toMatch(
      /className="grid grid-cols-1 gap-5 lg:grid-cols-\[264px_minmax\(0,1fr\)\] lg:items-start"/,
    );
  });

  it("/hr/customers and /hr/reports: the depot picker's wrapper may shrink below the longest option (+26px)", () => {
    expect(read('hr/customers/page.tsx')).toMatch(
      /<div className="flex min-w-0 flex-wrap items-center gap-3">\s*<HrDepotPicker \/>/,
    );
    expect(read('hr/reports/page.tsx')).toMatch(
      /<div className="min-w-0 text-sm">\s*<HrDepotPicker/,
    );
  });

  it('/hr/audit: a route-shaped action label may break anywhere (+33px)', () => {
    expect(read('hr/audit/page.tsx')).toMatch(
      /<span className="\[overflow-wrap:anywhere\]">\{actionLabel\(l\.action, t\)\}<\/span>/,
    );
  });
});
