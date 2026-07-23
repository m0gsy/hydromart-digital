import { describe, expect, it } from 'vitest';

import {
  canManageEarningRules,
  canManagePricing,
  canViewDashboard,
  dashboardLandingView,
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
    for (const r of ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'FINANCE', 'SUPER_ADMIN']) expect(isStaff(r)).toBe(true);
  });
});

describe('isHq (SUPER_ADMIN + HEAD_OFFICE only, NOT depot manager)', () => {
  it('admits only the two head-of-network roles', () => {
    expect(isHq('HEAD_OFFICE')).toBe(true);
    expect(isHq('SUPER_ADMIN')).toBe(true);
  });
  it('denies depot manager despite its dashboard power (design 20c)', () => {
    expect(isHq('DEPOT_MANAGER')).toBe(false);
    expect(canViewDashboard('DEPOT_MANAGER')).toBe(true); // has dashboard...
    expect(isHq('DEPOT_MANAGER')).toBe(false); // ...but not HQ reach
  });
});

describe('canManageEarningRules (finance config, role-gated directly)', () => {
  it('is FINANCE or SUPER_ADMIN only', () => {
    expect(canManageEarningRules('FINANCE')).toBe(true);
    expect(canManageEarningRules('SUPER_ADMIN')).toBe(true);
    expect(canManageEarningRules('DEPOT_MANAGER')).toBe(false);
  });
});

describe('capability wrappers delegate to the shared map', () => {
  it('canManagePricing maps to depotAdmin (manager/super-admin)', () => {
    expect(canManagePricing('DEPOT_MANAGER')).toBe(true);
    expect(canManagePricing('DEPOT_OPERATOR')).toBe(false);
  });
});

describe('dashboardLandingView (one route, four audiences)', () => {
  it('redirects franchise owners to their own overview', () => {
    expect(dashboardLandingView('FRANCHISE_OWNER')).toBe('franchise');
  });
  it('gives depot operators the daily summary, managers the ops landing', () => {
    expect(dashboardLandingView('DEPOT_OPERATOR')).toBe('operator');
    expect(dashboardLandingView('DEPOT_MANAGER')).toBe('manager');
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
    expect(isDepotOperator('DEPOT_OPERATOR')).toBe(true);
    expect(isDepotOperator('DEPOT_MANAGER')).toBe(false);
    expect(isDepotManager('DEPOT_MANAGER')).toBe(true);
    expect(isDepotManager('DEPOT_OPERATOR')).toBe(false);
  });
});
