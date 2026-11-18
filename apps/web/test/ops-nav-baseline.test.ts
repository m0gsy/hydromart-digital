import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Flow PR-3a moved the depot-console menu data out of the rail component into
 * `lib/ops-nav.ts`. A move changes nothing anyone sees: for each of the 13 roles, in the web
 * build and in the Ops APK, the menu is the one recorded from the rail BEFORE the move
 * (`fixtures/ops-menu-baseline.json`, written from `components/dashboard/ops-rail` on main).
 *
 * PR-3b regrouped the screens into hubs, so the screens are compared as a set per role. It
 * added one row on purpose: the operator console's own settings screen, which its bar always
 * showed, became a row of the table with its page's gate (`canUseOperatorConsole`). And the
 * HQ door of a console role without the overview (FINANCE, web only: Ops has no /hq) leads
 * to the first HQ screen it may open instead of the overview that refuses it.
 */
const ADDED: Record<string, string[]> = {
  // and the head of depot's /dashboard (their operator home) is a row with the page's gate.
  KEPALA_DEPOT: ['operations /dashboard'],
};
// PR-3d merged three screens into their twins; their rows went with them (the routes redirect).
const REMOVED: Record<string, string[]> = {
  MANAGER: ['depotSettings /dashboard/depot-settings', 'profile /dashboard/profile'],
  SUPER_ADMIN: ['depotSettings /dashboard/depot-settings', 'profile /dashboard/profile'],
};
const MOVED: Record<string, [from: string, to: string]> = {
  FINANCE: ['hqConsole /hq', 'hqConsole /hq/search'],
};
type Menus = Record<string, Record<string, string[]>>;
/** A role's screens as a set, whatever hub holds them. */
const screensOf = (m: Menus) =>
  Object.fromEntries(
    Object.entries(m).map(([role, groups]) => [role, Object.values(groups).flat().sort()]),
  );
/** The baseline's screens with the rows 3b changed on purpose. */
const expectedOf = (m: Menus) =>
  Object.fromEntries(
    Object.entries(screensOf(m)).map(([role, screens]) => {
      const moved = MOVED[role];
      const kept = moved ? screens.map((s) => (s === moved[0] ? moved[1] : s)) : screens;
      const gone = new Set(REMOVED[role] ?? []);
      return [role, [...kept.filter((s) => !gone.has(s)), ...(ADDED[role] ?? [])].sort()];
    }),
  );
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
    expect(screensOf(await menus())).toEqual(expectedOf(baseline.web));
  });

  it('Ops APK: every role sees exactly the menu it saw before', async () => {
    // The Ops build's prune list, as `canOpenRoute per binary` in route-access.test pins it.
    vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', '/hq/*,/hr,/hr/employees/*,/hr/payroll/*');
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', 'dashboard,driver,hr,m,resellers,login,products');
    vi.resetModules();
    // PR-4: leave ships in the Ops APK, so whoever had the leave row on the web has it there.
    const leave = 'hrLeave /hr/leave';
    const expected = Object.fromEntries(
      Object.entries(expectedOf(baseline.ops)).map(([role, screens]) => [
        role,
        screensOf(baseline.web)[role]?.includes(leave) ? [...screens, leave].sort() : screens,
      ]),
    );
    expect(screensOf(await menus())).toEqual(expected);
  });
});
