import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Flow PR-3a moved the depot-console menu data out of the rail component into
 * `lib/ops-nav.ts`. A move changes nothing anyone sees: for each of the 13 roles, in the web
 * build and in the Ops APK, the menu is the one recorded from the rail BEFORE the move
 * (`fixtures/ops-menu-baseline.json`, written from `components/dashboard/ops-rail` on main).
 */
const ROLES = [
  'CUSTOMER',
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
];
const baseline = JSON.parse(
  readFileSync(join(process.cwd(), 'test/fixtures/ops-menu-baseline.json'), 'utf8'),
) as Record<'web' | 'ops', Record<string, Record<string, string[]>>>;

async function menus(): Promise<Record<string, Record<string, string[]>>> {
  const { GROUPS } = await import('@/lib/ops-nav');
  const out: Record<string, Record<string, string[]>> = {};
  for (const role of ROLES) {
    out[role] = {};
    for (const g of GROUPS) {
      const items = g.items.filter((i) => i.show(role)).map((i) => `${i.labelKey} ${i.href}`);
      if (items.length) out[role][g.headKey] = items;
    }
  }
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('ops menu after the move to lib/ops-nav', () => {
  it('web: every role sees exactly the menu it saw before', async () => {
    expect(await menus()).toEqual(baseline.web);
  });

  it('Ops APK: every role sees exactly the menu it saw before', async () => {
    // The Ops build's prune list, as `canOpenRoute per binary` in route-access.test pins it.
    vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', '/hq/*,/hr,/hr/employees/*,/hr/payroll/*,/hr/leave/*');
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', 'dashboard,driver,hr,m,resellers,login,products');
    vi.resetModules();
    expect(await menus()).toEqual(baseline.ops);
  });
});
