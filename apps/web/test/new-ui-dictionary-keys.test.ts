import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { hrFix as en } from '@/lib/dictionaries/en/hrFix';
import { hrFix as id } from '@/lib/dictionaries/id/hrFix';

/**
 * Every `hrFix.*` key the cross-depot / import screens ask for must exist in BOTH languages.
 *
 * Why this exists: a dictionary insert that matched the wrong block put "Setujui" / "Tolak"
 * under `common`, and the buttons on the employee card rendered the raw key
 * `hrFix.depotAssignment.approve`. tsc cannot see it (keys are strings), the i18n gate looks
 * for hardcoded Indonesian, not missing keys, and nothing rendered the card until a test did.
 */
const FILES = [
  'src/components/hr/employee-depot-assignment.tsx',
  'src/components/hr/payroll-share-editor.tsx',
  'src/app/hr/depot-requests/page.tsx',
  'src/app/hr/payroll/detail/page.tsx',
  'src/app/hr/payroll/import/page.tsx',
  'src/app/hr/attendance/import/page.tsx',
  'src/app/hr/shift/import/page.tsx',
  'src/app/hq/catalog/import/page.tsx',
  'src/app/hq/catalog/import-categories/page.tsx',
  'src/app/dashboard/returns/import/page.tsx',
  'src/app/dashboard/customers/import-addresses/page.tsx',
];

// Keys built at runtime, listed by hand: the literal never appears in source.
const DYNAMIC = [
  ...['REQUESTED', 'PLANNED', 'ACTIVE', 'DONE', 'CANCELLED', 'FAILED'].map((s) => `depotAssignment.status.${s}`),
  'nav.depotRequests',
  ...['LOAN', 'PERMANENT'].map((k) => `depotAssignment.kind.${k}`),
  ...['days', 'gross', 'bonus', 'deduction', 'shortfall'].map((c) => `payrollDetail.col.${c}`),
];

const lookup = (dict: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict);

const used = new Set<string>(DYNAMIC);
for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/['"`](hrFix\.[A-Za-z0-9_.]+)['"`]/g)) {
    const key = m[1]!;
    if (!key.endsWith('.')) used.add(key.slice('hrFix.'.length));
  }
}

describe('keys used by the new screens exist in both languages', () => {
  it('found something to check', () => {
    expect(used.size).toBeGreaterThan(40);
  });

  it.each([...used].sort())('%s', (key) => {
    expect(typeof lookup(id, key), `id is missing ${key}`).toBe('string');
    expect(typeof lookup(en, key), `en is missing ${key}`).toBe('string');
  });
});
