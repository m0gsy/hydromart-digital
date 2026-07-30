import {
  CAPABILITIES,
  can,
  capabilitiesFor,
  currentOverrides,
  effectiveMatrix,
  loadOverrides,
  rolesFor,
  type Role,
} from './index';

// The live map is module state, so every test starts from "no overrides" — which is
// also the state a service boots in and the state it falls back to when the override
// source is unreachable.
afterEach(() => loadOverrides({}));

describe('capability overrides', () => {
  it('resolves to the compiled default when nothing is overridden', () => {
    expect(rolesFor('inventoryWrite')).toEqual(CAPABILITIES.inventoryWrite);
    expect(currentOverrides()).toEqual({});
  });

  it('lets an override replace the default outright, not merge with it', () => {
    loadOverrides({ inventoryWrite: ['KEPALA_DEPOT'] });
    expect(rolesFor('inventoryWrite')).toEqual(['KEPALA_DEPOT']);
    expect(can('inventoryWrite', 'MANAGER')).toBe(false);
    expect(can('inventoryWrite', 'KEPALA_DEPOT')).toBe(true);
  });

  it('treats an empty override as "nobody but the superuser"', () => {
    loadOverrides({ approvals: [] });
    expect(can('approvals', 'MANAGER')).toBe(false);
    expect(can('approvals', 'SUPER_ADMIN')).toBe(true);
  });

  it('keeps SUPER_ADMIN above the override lookup, so the lock cannot be locked away', () => {
    loadOverrides({ accessMatrixWrite: [] as Role[] });
    expect(can('accessMatrixWrite', 'SUPER_ADMIN')).toBe(true);
  });

  it('leaves untouched capabilities on their defaults', () => {
    loadOverrides({ inventoryWrite: ['KEPALA_DEPOT'] });
    expect(rolesFor('approvals')).toEqual(CAPABILITIES.approvals);
  });

  it('denies an unknown capability name rather than resolving through the prototype', () => {
    expect(rolesFor('constructor')).toEqual([]);
    expect(rolesFor('toString')).toEqual([]);
    expect(rolesFor('inventoryWirte')).toEqual([]);
  });

  it('honours an override whose key collides with an Object member', () => {
    // hasOwnProperty, not `?? default`: a patch parsed from JSON can carry any key.
    loadOverrides({ constructor: ['HEAD_OFFICE'] as Role[] });
    expect(rolesFor('constructor')).toEqual(['HEAD_OFFICE']);
  });

  it('reports the effective matrix with overrides applied', () => {
    loadOverrides({ approvals: ['SUPERVISOR'] });
    const matrix = effectiveMatrix();
    expect(matrix.approvals).toEqual(['SUPERVISOR']);
    expect(matrix.inventoryWrite).toEqual(CAPABILITIES.inventoryWrite);
    expect(Object.keys(matrix).sort()).toEqual(Object.keys(CAPABILITIES).sort());
  });

  it('lists a role capabilities from the live map, not the compiled one', () => {
    expect(capabilitiesFor('SUPERVISOR')).not.toContain('approvals');
    loadOverrides({ approvals: ['SUPERVISOR'] });
    expect(capabilitiesFor('SUPERVISOR')).toContain('approvals');
  });

  it('gives SUPER_ADMIN every capability and a signed-out caller none', () => {
    expect(capabilitiesFor('SUPER_ADMIN')).toHaveLength(Object.keys(CAPABILITIES).length);
    expect(capabilitiesFor(null)).toEqual([]);
    expect(capabilitiesFor(undefined)).toEqual([]);
  });
});
