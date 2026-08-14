import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canManageEarningRules,
  canManageRoster,
  canManagePricing,
  canViewDashboard,
  canPunchAttendance,
  canUseCourierApp,
  canUseManagerConsole,
  canUseOperatorConsole,
  consoleHome,
  dashboardLandingView,
  isConsolePath,
  isDepotManager,
  isDepotOperator,
  isHq,
  isStaff,
} from '@/lib/roles';

// The capability MAP is tested in @hydromart/access. These lock the web-only gates
// that are deliberately NOT capabilities (coarse role checks + finance-config roles).

describe('isStaff', () => {
  it('is false for customer / empty / nullish', () => {
    for (const r of ['CUSTOMER', '', null, undefined]) expect(isStaff(r)).toBe(false);
  });
  it('is true for any non-customer role', () => {
    for (const r of ['KEPALA_DEPOT', 'MANAGER', 'FINANCE', 'SUPER_ADMIN']) expect(isStaff(r)).toBe(true);
  });
});

describe('isHq (SUPER_ADMIN + HEAD_OFFICE only, NOT depot manager)', () => {
  it('admits only the two head-of-network roles', () => {
    expect(isHq('HEAD_OFFICE')).toBe(true);
    expect(isHq('SUPER_ADMIN')).toBe(true);
  });
  it('denies depot manager despite its dashboard power (design 20c)', () => {
    expect(isHq('MANAGER')).toBe(false);
    expect(canViewDashboard('MANAGER')).toBe(true); // has dashboard...
    expect(isHq('MANAGER')).toBe(false); // ...but not HQ reach
  });
});

describe('canManageEarningRules (finance config, role-gated directly)', () => {
  it('is FINANCE or SUPER_ADMIN only', () => {
    expect(canManageEarningRules('FINANCE')).toBe(true);
    expect(canManageEarningRules('SUPER_ADMIN')).toBe(true);
    expect(canManageEarningRules('MANAGER')).toBe(false);
  });
});

describe('capability wrappers delegate to the shared map', () => {
  it('canManagePricing maps to depotAdmin (manager/super-admin)', () => {
    expect(canManagePricing('MANAGER')).toBe(true);
    expect(canManagePricing('KEPALA_DEPOT')).toBe(false);
  });
});

describe('dashboardLandingView (one route, four audiences)', () => {
  it('redirects franchise owners to their own overview', () => {
    expect(dashboardLandingView('FRANCHISE_OWNER')).toBe('franchise');
  });
  it('gives depot operators the daily summary, managers the ops landing', () => {
    expect(dashboardLandingView('KEPALA_DEPOT')).toBe('operator');
    expect(dashboardLandingView('MANAGER')).toBe('manager');
  });
  it('gives head-office roles the executive view', () => {
    for (const r of ['HEAD_OFFICE', 'SUPER_ADMIN']) expect(dashboardLandingView(r)).toBe('executive');
  });
  it('denies customers, FINANCE (no dashboard capability), and unknown/nullish roles', () => {
    for (const r of ['CUSTOMER', 'FINANCE', 'NOPE', '', null, undefined]) expect(dashboardLandingView(r)).toBe('denied');
  });
});

describe('role identity helpers', () => {
  it('match exactly one role each', () => {
    expect(isDepotOperator('KEPALA_DEPOT')).toBe(true);
    expect(isDepotOperator('MANAGER')).toBe(false);
    expect(isDepotManager('MANAGER')).toBe(true);
    expect(isDepotManager('KEPALA_DEPOT')).toBe(false);
  });

  // The identity helpers must stay exact even though the ENTRY gates below let a super
  // admin in: if isDepotOperator() widened, dashboardLandingView() would hand a super
  // admin the operator console instead of the executive one.
  it('stay exact for SUPER_ADMIN, so shell selection is unchanged', () => {
    expect(isDepotOperator('SUPER_ADMIN')).toBe(false);
    expect(isDepotManager('SUPER_ADMIN')).toBe(false);
    expect(dashboardLandingView('SUPER_ADMIN')).toBe('executive');
  });
});

// The bug these gates fix: a super admin holds every capability in @hydromart/access yet
// was refused /driver, /m/manager and 11 /dashboard pages, because those compared the
// role string exactly.
describe('console entry gates', () => {
  it('admit the console owner and the super admin, nobody else', () => {
    expect(canUseManagerConsole('MANAGER')).toBe(true);
    expect(canUseOperatorConsole('KEPALA_DEPOT')).toBe(true);
    expect(canUseCourierApp('STAFF_DEPOT')).toBe(true);
    for (const gate of [canUseManagerConsole, canUseOperatorConsole, canUseCourierApp]) {
      expect(gate('SUPER_ADMIN')).toBe(true);
      for (const r of ['CUSTOMER', 'FINANCE', 'HR', 'NOPE', '', null, undefined]) {
        expect(gate(r)).toBe(false);
      }
    }
  });

  it('do not admit each other — a manager is still not a courier', () => {
    expect(canUseCourierApp('MANAGER')).toBe(false);
    expect(canUseManagerConsole('KEPALA_DEPOT')).toBe(false);
    expect(canUseOperatorConsole('MANAGER')).toBe(false);
  });
});

// The whole depot chain clocks in, not just the two roles with an obvious shift.
describe('canPunchAttendance', () => {
  it('admits every depot rank that clocks in', () => {
    for (const r of ['STAFF_DEPOT', 'KEPALA_DEPOT', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR']) {
      expect(canPunchAttendance(r)).toBe(true);
    }
    expect(canPunchAttendance('SUPER_ADMIN')).toBe(true);
  });

  it('leaves the office roles and customers out', () => {
    for (const r of ['CUSTOMER', 'HEAD_OFFICE', 'FINANCE', 'HR', 'NOPE', '', null, undefined]) {
      expect(canPunchAttendance(r)).toBe(false);
    }
  });
});

// Both the shop-chrome split and the login-door choice read this, so a wrong answer
// either strips a customer page of its nav or sends a courier to the customer door.
describe('isConsolePath', () => {
  it('claims a console root and everything under it', () => {
    for (const p of ['/hq', '/hq/orders', '/dashboard', '/dashboard/inventory', '/hr/me', '/driver', '/m/manager'])
      expect(isConsolePath(p)).toBe(true);
  });

  it('respects the segment boundary — /m does not swallow /mother', () => {
    for (const p of ['/mother', '/hqx', '/dashboards', '/driverless'])
      expect(isConsolePath(p)).toBe(false);
  });

  it('leaves the shop (and /resellers, which has no console layout) alone', () => {
    for (const p of ['/', '/products', '/cart', '/login', '/resellers', '', null, undefined])
      expect(isConsolePath(p)).toBe(false);
  });
});

describe('consoleHome', () => {
  it('sends each role to the console it owns', () => {
    for (const r of ['HEAD_OFFICE', 'SUPER_ADMIN', 'DIREKTUR']) expect(consoleHome(r)).toBe('/hq');
    expect(consoleHome('STAFF_DEPOT')).toBe('/driver');
    for (const r of ['MANAGER', 'KEPALA_DEPOT', 'SUPERVISOR', 'FRANCHISE_OWNER'])
      expect(consoleHome(r)).toBe('/dashboard');
    expect(consoleHome('HR')).toBe('/hr');
    expect(consoleHome('MARKETING')).toBe('/dashboard/campaigns');
  });

  it('sends a customer to the shop, never into a console', () => {
    for (const r of ['CUSTOMER', '', null, undefined]) expect(consoleHome(r)).toBe('/products');
  });

  // The regression this fixes: /hq/login bounced on an exact HEAD_OFFICE/SUPER_ADMIN
  // check, so a DIREKTUR signed in and then sat on the login screen.
  it('never lands a role on a page its own gate would deny', () => {
    expect(isConsolePath(consoleHome('DIREKTUR'))).toBe(true);
    expect(consoleHome('DIREKTUR')).toBe('/hq');
  });
});

/*
 * B7. `/dashboard/shift` gated its Atur-shift button on `isStaff` — "anybody who is not a
 * customer" — while writing the roster needs `driverRoster`. A DEPOT_OPERATOR got a
 * clickable grid where every click 403'd and the cell snapped back with no explanation.
 */
describe('canManageRoster', () => {
  it('lets the roles that actually hold driverRoster edit the roster', () => {
    expect(canManageRoster('KEPALA_DEPOT')).toBe(true);
    expect(canManageRoster('MANAGER')).toBe(true);
    expect(canManageRoster('SUPER_ADMIN')).toBe(true);
  });

  it('refuses depot staff, who can read the grid but not write it', () => {
    expect(canManageRoster('STAFF_DEPOT')).toBe(false);
    expect(canManageRoster('CUSTOMER')).toBe(false);
    expect(canManageRoster(null)).toBe(false);
    expect(canManageRoster(undefined)).toBe(false);
  });
});

/**
 * The Ops binary prunes the whole `/hq` subtree, `/hq/login` included, while every console
 * screen sent an expired session and every sign-out button there. The redirect landed on a
 * route that is not in that bundle: no error, no door, no way back into the app — on a binary
 * that was already in Play internal testing.
 *
 * The prune list is read from `NEXT_PUBLIC_MOBILE_PRUNED` at module load (the build writes it,
 * so it cannot disagree with what was pruned), hence the re-import per case.
 */
describe('staffDoor / consoleHome respect what this binary actually serves', () => {
  async function load(pruned: string | undefined) {
    vi.resetModules();
    if (pruned === undefined) vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', '');
    else vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', pruned);
    return import('@/lib/roles');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the branded staff door on the web, where nothing is pruned', async () => {
    const { staffDoor } = await load(undefined);
    expect(staffDoor('/dashboard/orders')).toBe('/hq/login');
    expect(staffDoor('/hr/me')).toBe('/hq/login');
    expect(staffDoor('/products')).toBe('/login');
  });

  it('falls back to /login in a binary that pruned /hq', async () => {
    const { staffDoor } = await load('/hq/*,/hr');
    expect(staffDoor('/dashboard/orders')).toBe('/login');
    expect(staffDoor('/hr/me')).toBe('/login');
  });

  it('never sends an HQ or HR role to a console the binary dropped', async () => {
    const { consoleHome } = await load('/hq/*,/hr');
    // /hq is gone; a head-office account still has the depot console in the Ops app.
    expect(consoleHome('HEAD_OFFICE')).toBe('/dashboard');
    // The HR console index is pruned but /hr/me survives — that is where HR belongs here.
    expect(consoleHome('HR')).toBe('/hr/me');
  });

  it('keeps the web answers unchanged', async () => {
    const { consoleHome } = await load(undefined);
    expect(consoleHome('HEAD_OFFICE')).toBe('/hq');
    expect(consoleHome('HR')).toBe('/hr');
    expect(consoleHome('STAFF_DEPOT')).toBe('/driver');
    expect(consoleHome('CUSTOMER')).toBe('/products');
  });
});
