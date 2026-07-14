import { CAPABILITIES, can } from './index';

describe('CAPABILITIES', () => {
  it('grants a capability only to its listed roles', () => {
    expect(can('inventoryWrite', 'DEPOT_OPERATOR')).toBe(true);
    expect(can('inventoryWrite', 'HEAD_OFFICE')).toBe(false); // read-only, not write
    expect(can('payout', 'FRANCHISE_OWNER')).toBe(true);
    expect(can('payout', 'SUPER_ADMIN')).toBe(false);
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
  });
});
