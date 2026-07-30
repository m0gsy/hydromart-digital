import { CAPABILITIES, STAFF_IMPORT_ROLES, can } from './index';

describe('CAPABILITIES', () => {
  it('grants a capability only to its listed roles', () => {
    expect(can('inventoryWrite', 'KEPALA_DEPOT')).toBe(true);
    expect(can('inventoryWrite', 'HEAD_OFFICE')).toBe(false); // read-only, not write
    expect(can('payout', 'FRANCHISE_OWNER')).toBe(true);
    // SUPER_ADMIN is a superuser: holds every capability even when not listed.
    expect(can('payout', 'SUPER_ADMIN')).toBe(true);
    expect(can('courierPayout', 'SUPER_ADMIN')).toBe(true);
  });

  it('rejects null / empty / customer roles', () => {
    expect(can('orderQueue', null)).toBe(false);
    expect(can('orderQueue', undefined)).toBe(false);
    expect(can('orderQueue', '')).toBe(false);
    expect(can('orderQueue', 'CUSTOMER')).toBe(false);
  });

  it('read capability is a superset of its write sibling', () => {
    for (const w of CAPABILITIES.inventoryWrite) {
      expect(CAPABILITIES.inventoryRead).toContain(w);
    }
    for (const w of CAPABILITIES.resellerAdmin) {
      expect(CAPABILITIES.resellerView).toContain(w);
    }
    for (const w of CAPABILITIES.depotCrmWrite) {
      expect(CAPABILITIES.depotCrm).toContain(w);
    }
  });

  it('lets HR read the customer & reseller directories but not write them', () => {
    expect(can('depotCrm', 'HR')).toBe(true);
    expect(can('resellerView', 'HR')).toBe(true);
    expect(can('resellerAdmin', 'HR')).toBe(false);
    expect(can('depotCrmWrite', 'HR')).toBe(false);
    // HR must never gain the staff directory: inviteStaff takes an arbitrary role.
    expect(can('staffAdmin', 'HR')).toBe(false);
  });

  it('never lets a bulk employee import provision an office/superuser account', () => {
    expect(STAFF_IMPORT_ROLES).not.toContain('HEAD_OFFICE');
    expect(STAFF_IMPORT_ROLES).not.toContain('SUPER_ADMIN');
    expect(STAFF_IMPORT_ROLES).not.toContain('CUSTOMER');
    expect(STAFF_IMPORT_ROLES).toContain('KEPALA_DEPOT');
  });
});
