import { describe, expect, it } from 'vitest';

import { canViewDashboard, canViewInventory, canWriteInventory, isStaff } from '@/lib/roles';

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

describe('inventory roles', () => {
  it('READ allows operators, managers, head-office, super-admin; not drivers/customers', () => {
    expect(canViewInventory('DEPOT_OPERATOR')).toBe(true);
    expect(canViewInventory('DEPOT_MANAGER')).toBe(true);
    expect(canViewInventory('HEAD_OFFICE')).toBe(true);
    expect(canViewInventory('SUPER_ADMIN')).toBe(true);
    expect(canViewInventory('DRIVER')).toBe(false);
    expect(canViewInventory('CUSTOMER')).toBe(false);
    expect(canViewInventory(null)).toBe(false);
  });

  it('WRITE excludes head-office (read-only) and drivers/customers', () => {
    expect(canWriteInventory('DEPOT_OPERATOR')).toBe(true);
    expect(canWriteInventory('DEPOT_MANAGER')).toBe(true);
    expect(canWriteInventory('SUPER_ADMIN')).toBe(true);
    expect(canWriteInventory('HEAD_OFFICE')).toBe(false);
    expect(canWriteInventory('DRIVER')).toBe(false);
    expect(canWriteInventory('CUSTOMER')).toBe(false);
    expect(canWriteInventory(undefined)).toBe(false);
  });
});
