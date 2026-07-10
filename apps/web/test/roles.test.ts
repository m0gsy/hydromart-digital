import { describe, expect, it } from 'vitest';

import { canViewDashboard, isStaff } from '@/lib/roles';

describe('canViewDashboard', () => {
  it('allows head-office and depot managers', () => {
    expect(canViewDashboard('HEAD_OFFICE')).toBe(true);
    expect(canViewDashboard('DEPOT_MANAGER')).toBe(true);
    expect(canViewDashboard('SUPER_ADMIN')).toBe(true);
  });

  it('blocks customers, drivers, operators and unknown/empty roles', () => {
    expect(canViewDashboard('CUSTOMER')).toBe(false);
    expect(canViewDashboard('DRIVER')).toBe(false);
    expect(canViewDashboard('DEPOT_OPERATOR')).toBe(false);
    expect(canViewDashboard(null)).toBe(false);
    expect(canViewDashboard(undefined)).toBe(false);
    expect(canViewDashboard('')).toBe(false);
  });
});

describe('isStaff', () => {
  it('is true for any non-customer role', () => {
    expect(isStaff('DEPOT_OPERATOR')).toBe(true);
    expect(isStaff('DRIVER')).toBe(true);
    expect(isStaff('HEAD_OFFICE')).toBe(true);
  });

  it('is false for customers and empty/unknown', () => {
    expect(isStaff('CUSTOMER')).toBe(false);
    expect(isStaff(null)).toBe(false);
    expect(isStaff(undefined)).toBe(false);
    expect(isStaff('')).toBe(false);
  });
});
