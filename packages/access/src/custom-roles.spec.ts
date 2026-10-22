import {
  CUSTOM_FORBIDDEN,
  canGrantRole,
  can,
  capabilitiesFor,
  currentCustomRoles,
  currentDepotOverrides,
  customRoleScope,
  grantorsFor,
  isCustomRoleKey,
  loadCustomRoles,
  loadDepotOverrides,
  loadOverrides,
  loadRoleSettings,
  currentRoleSettings,
  isRoleDisabled,
  roleScopeSetting,
} from './index';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

afterEach(() => {
  loadOverrides({});
  loadCustomRoles([]);
  loadDepotOverrides([]);
});

describe('custom roles', () => {
  it('a custom key that is not loaded holds nothing, even if an override names it', () => {
    loadOverrides({ dashboard: ['C_kasir'] });
    expect(can('dashboard', 'C_kasir')).toBe(false);
    expect(capabilitiesFor('C_kasir')).toEqual([]);
  });

  it('an active custom role holds exactly what the matrix gives it', () => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }]);
    loadOverrides({ dashboard: ['C_kasir'] });
    expect(can('dashboard', 'C_kasir')).toBe(true);
    expect(can('hqConsole', 'C_kasir')).toBe(false);
    expect(capabilitiesFor('C_kasir')).toContain('dashboard');
  });

  it('refuses CUSTOM_FORBIDDEN capabilities even when a row grants them', () => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'GLOBAL' }]);
    for (const cap of CUSTOM_FORBIDDEN) {
      loadOverrides({ [cap]: ['C_kasir'] });
      loadDepotOverrides([{ capability: cap, roleKey: 'C_kasir', depotId: A, effect: 'GRANT' }]);
      expect(can(cap, 'C_kasir')).toBe(false);
      expect(can(cap, 'C_kasir', [A])).toBe(false);
    }
  });

  it('scope: built-in is undefined, unknown/archived custom is LOCKED, loaded custom is its own', () => {
    expect(customRoleScope('MANAGER')).toBeUndefined();
    expect(customRoleScope(null)).toBeUndefined();
    expect(customRoleScope('C_gone')).toBe('LOCKED');
    loadCustomRoles([{ key: 'C_x', name: 'X', scope: 'RESOLVED' }]);
    expect(customRoleScope('C_x')).toBe('RESOLVED');
    expect(currentCustomRoles()).toHaveLength(1);
    expect(isCustomRoleKey('C_x')).toBe(true);
    expect(isCustomRoleKey('MANAGER')).toBe(false);
    expect(isCustomRoleKey(undefined)).toBe(false);
  });

  it('only SUPER_ADMIN may grant a custom role', () => {
    expect(canGrantRole('SUPER_ADMIN', 'C_x')).toBe(true);
    expect(canGrantRole('HEAD_OFFICE', 'C_x')).toBe(false);
    expect(canGrantRole(undefined, 'C_x')).toBe(false);
    expect(grantorsFor('C_x')).toEqual(['SUPER_ADMIN']);
  });
});

describe('per-depot overrides', () => {
  beforeEach(() => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }]);
  });

  it('GRANT opens a capability only at that depot, and only when the request names it', () => {
    loadDepotOverrides([{ capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'GRANT' }]);
    expect(can('dashboard', 'C_kasir', [A])).toBe(true);
    expect(can('dashboard', 'C_kasir', [B])).toBe(false);
    expect(can('dashboard', 'C_kasir')).toBe(false);
    expect(can('dashboard', 'C_kasir', [])).toBe(false);
  });

  it('a partial GRANT across several depots is not a grant', () => {
    loadDepotOverrides([{ capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'GRANT' }]);
    expect(can('dashboard', 'C_kasir', [A, B])).toBe(false);
  });

  it('DENY beats the global list', () => {
    loadOverrides({ dashboard: ['C_kasir', 'STAFF_DEPOT'] });
    loadDepotOverrides([
      { capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'DENY' },
      { capability: 'dashboard', roleKey: 'STAFF_DEPOT', depotId: A, effect: 'DENY' },
    ]);
    expect(can('dashboard', 'C_kasir', [A])).toBe(false);
    expect(can('dashboard', 'C_kasir', [B])).toBe(true);
    expect(can('dashboard', 'C_kasir')).toBe(true);
    expect(can('dashboard', 'STAFF_DEPOT', [A])).toBe(false);
  });

  it('SUPER_ADMIN ignores every override', () => {
    loadDepotOverrides([{ capability: 'dashboard', roleKey: 'SUPER_ADMIN', depotId: A, effect: 'DENY' }]);
    expect(can('dashboard', 'SUPER_ADMIN', [A])).toBe(true);
  });

  it('no role means no access', () => {
    expect(can('dashboard', null, [A])).toBe(false);
    expect(can('dashboard', undefined)).toBe(false);
  });

  it('round-trips the snapshot', () => {
    const rows = [{ capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'GRANT' as const }];
    loadDepotOverrides(rows);
    expect(currentDepotOverrides()).toEqual(rows);
  });
});

describe('built-in role settings', () => {
  afterEach(() => {
    loadRoleSettings([]);
    loadOverrides({});
  });

  it('a disabled built-in role holds nothing, but SUPER_ADMIN and CUSTOMER cannot be disabled', () => {
    expect(can('orderQueue', 'STAFF_DEPOT')).toBe(true);
    loadRoleSettings([
      { roleKey: 'STAFF_DEPOT', disabled: true },
      { roleKey: 'SUPER_ADMIN', disabled: true },
      { roleKey: 'CUSTOMER', disabled: true },
    ]);
    expect(can('orderQueue', 'STAFF_DEPOT')).toBe(false);
    expect(capabilitiesFor('STAFF_DEPOT')).toEqual([]);
    expect(isRoleDisabled('STAFF_DEPOT')).toBe(true);
    expect(can('dashboard', 'SUPER_ADMIN')).toBe(true);
    expect(isRoleDisabled('SUPER_ADMIN')).toBe(false);
    expect(isRoleDisabled('CUSTOMER')).toBe(false);
    expect(isRoleDisabled(null)).toBe(false);
  });

  it('re-enabling restores the compiled behaviour', () => {
    loadRoleSettings([{ roleKey: 'STAFF_DEPOT', disabled: true }]);
    loadRoleSettings([{ roleKey: 'STAFF_DEPOT', disabled: false, name: 'Staf' }]);
    expect(can('orderQueue', 'STAFF_DEPOT')).toBe(true);
    expect(currentRoleSettings()).toHaveLength(1);
  });

  it('a scope setting answers for editable roles only', () => {
    loadRoleSettings([
      { roleKey: 'MANAGER', scope: 'LOCKED' },
      { roleKey: 'FRANCHISE_OWNER', scope: 'GLOBAL' },
      { roleKey: 'SUPER_ADMIN', scope: 'LOCKED' },
      { roleKey: 'HR' },
    ]);
    expect(roleScopeSetting('MANAGER')).toBe('LOCKED');
    expect(roleScopeSetting('FRANCHISE_OWNER')).toBeUndefined();
    expect(roleScopeSetting('SUPER_ADMIN')).toBeUndefined();
    expect(roleScopeSetting('HR')).toBeUndefined();
    expect(roleScopeSetting('STAFF_DEPOT')).toBeUndefined();
    expect(roleScopeSetting(null)).toBeUndefined();
  });
});
