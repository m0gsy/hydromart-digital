import { describe, expect, it } from 'vitest';

import {
  canManageCampaigns,
  canManageDepots,
  canManagePricing,
  canViewCampaigns,
  canViewChurn,
  canViewDashboard,
  canViewForecast,
  canViewFranchise,
  canViewInventory,
  canWriteInventory,
  isStaff,
} from '@/lib/roles';

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

describe('campaign roles', () => {
  it('READ allows marketing, head-office, super-admin; not operators/customers', () => {
    expect(canViewCampaigns('MARKETING')).toBe(true);
    expect(canViewCampaigns('HEAD_OFFICE')).toBe(true);
    expect(canViewCampaigns('SUPER_ADMIN')).toBe(true);
    expect(canViewCampaigns('DEPOT_OPERATOR')).toBe(false);
    expect(canViewCampaigns('CUSTOMER')).toBe(false);
    expect(canViewCampaigns(null)).toBe(false);
  });

  it('WRITE is marketing + super-admin; head-office is read-only', () => {
    expect(canManageCampaigns('MARKETING')).toBe(true);
    expect(canManageCampaigns('SUPER_ADMIN')).toBe(true);
    expect(canManageCampaigns('HEAD_OFFICE')).toBe(false);
    expect(canManageCampaigns('DEPOT_MANAGER')).toBe(false);
    expect(canManageCampaigns('CUSTOMER')).toBe(false);
    expect(canManageCampaigns(undefined)).toBe(false);
  });
});

describe('canManageDepots', () => {
  it('allows depot managers and super-admin only', () => {
    expect(canManageDepots('DEPOT_MANAGER')).toBe(true);
    expect(canManageDepots('SUPER_ADMIN')).toBe(true);
    expect(canManageDepots('HEAD_OFFICE')).toBe(false);
    expect(canManageDepots('DEPOT_OPERATOR')).toBe(false);
    expect(canManageDepots('CUSTOMER')).toBe(false);
    expect(canManageDepots(null)).toBe(false);
  });
});

describe('canManagePricing', () => {
  it('allows manager + super-admin only', () => {
    expect(canManagePricing('DEPOT_MANAGER')).toBe(true);
    expect(canManagePricing('SUPER_ADMIN')).toBe(true);
    expect(canManagePricing('CUSTOMER')).toBe(false);
    expect(canManagePricing(null)).toBe(false);
  });
});

describe('canViewForecast', () => {
  it('allows the planning roles (operator, manager, head-office, super-admin, franchise owner)', () => {
    expect(canViewForecast('DEPOT_OPERATOR')).toBe(true);
    expect(canViewForecast('DEPOT_MANAGER')).toBe(true);
    expect(canViewForecast('HEAD_OFFICE')).toBe(true);
    expect(canViewForecast('SUPER_ADMIN')).toBe(true);
    expect(canViewForecast('FRANCHISE_OWNER')).toBe(true);
  });

  it('blocks customers, drivers and unknown/empty roles', () => {
    expect(canViewForecast('CUSTOMER')).toBe(false);
    expect(canViewForecast('DRIVER')).toBe(false);
    expect(canViewForecast(null)).toBe(false);
    expect(canViewForecast(undefined)).toBe(false);
    expect(canViewForecast('')).toBe(false);
  });
});

describe('canViewChurn', () => {
  it('allows the churn roles (marketing, manager, head-office, super-admin)', () => {
    expect(canViewChurn('MARKETING')).toBe(true);
    expect(canViewChurn('DEPOT_MANAGER')).toBe(true);
    expect(canViewChurn('HEAD_OFFICE')).toBe(true);
    expect(canViewChurn('SUPER_ADMIN')).toBe(true);
  });

  it('blocks customers, planning-only operators, and unknown/empty roles', () => {
    expect(canViewChurn('CUSTOMER')).toBe(false);
    expect(canViewChurn('DEPOT_OPERATOR')).toBe(false);
    expect(canViewChurn('DRIVER')).toBe(false);
    expect(canViewChurn(null)).toBe(false);
    expect(canViewChurn(undefined)).toBe(false);
    expect(canViewChurn('')).toBe(false);
  });
});

describe('canViewFranchise', () => {
  it('allows franchise owners only', () => {
    expect(canViewFranchise('FRANCHISE_OWNER')).toBe(true);
    expect(canViewFranchise('SUPER_ADMIN')).toBe(false);
    expect(canViewFranchise('DEPOT_MANAGER')).toBe(false);
    expect(canViewFranchise('CUSTOMER')).toBe(false);
    expect(canViewFranchise(null)).toBe(false);
  });
});
