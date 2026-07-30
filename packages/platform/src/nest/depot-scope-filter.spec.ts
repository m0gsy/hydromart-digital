import { ForbiddenException } from '@nestjs/common';

import { Role } from '../domain/role.enum';
import { assertDepotAccess, depotScopeIds, depotWhere } from './depot-scope';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

describe('depotScopeIds', () => {
  it('forces a locked role to its own depot, allowing only its own request', () => {
    expect(depotScopeIds({ role: Role.KEPALA_DEPOT, depotId: A })).toEqual([A]);
    expect(depotScopeIds({ role: Role.KEPALA_DEPOT, depotId: A }, A)).toEqual([A]);
    expect(depotScopeIds({ role: Role.STAFF_DEPOT, depotId: A })).toEqual([A]);
  });

  it('forbids a locked role asking for another depot', () => {
    expect(() => depotScopeIds({ role: Role.KEPALA_DEPOT, depotId: A }, B)).toThrow(
      ForbiddenException,
    );
  });

  it('forbids a locked role with no assigned depot', () => {
    expect(() => depotScopeIds({ role: Role.KEPALA_DEPOT, depotId: null })).toThrow(
      ForbiddenException,
    );
  });

  // The bug this rename exists to prevent: a supervisor covering many depots must not be
  // narrowed to one of them by a list endpoint that forgot to handle a set.
  it('returns the WHOLE set for a supervisor listing without a filter', () => {
    expect(depotScopeIds({ role: Role.SUPERVISOR, depotIds: [A, B, C] })).toEqual([A, B, C]);
    expect(depotScopeIds({ role: Role.MANAGER, depotIds: [A, B] })).toEqual([A, B]);
  });

  it('narrows a supervisor to one depot inside their set, and forbids one outside it', () => {
    expect(depotScopeIds({ role: Role.SUPERVISOR, depotIds: [A, B] }, B)).toEqual([B]);
    expect(() => depotScopeIds({ role: Role.SUPERVISOR, depotIds: [A, B] }, C)).toThrow(
      ForbiddenException,
    );
  });

  it('forbids a scoped role with an empty set — nothing assigned means nothing seen', () => {
    expect(() => depotScopeIds({ role: Role.SUPERVISOR, depotIds: [] })).toThrow(
      ForbiddenException,
    );
    expect(() => depotScopeIds({ role: Role.ASSISTANT_SUPERVISOR, depotIds: [] }, A)).toThrow(
      ForbiddenException,
    );
  });

  it('lets bypass roles see all (undefined) or one requested depot', () => {
    expect(depotScopeIds({ role: Role.HEAD_OFFICE, depotId: null })).toBeUndefined();
    expect(depotScopeIds({ role: Role.DIREKTUR, depotId: null })).toBeUndefined();
    expect(depotScopeIds({ role: Role.SUPER_ADMIN, depotId: null }, B)).toEqual([B]);
    expect(depotScopeIds(undefined)).toBeUndefined();
  });
});

describe('assertDepotAccess', () => {
  it('accepts any depot in the caller set and rejects the rest', () => {
    expect(() => assertDepotAccess({ role: Role.SUPERVISOR, depotIds: [A, B] }, B)).not.toThrow();
    expect(() => assertDepotAccess({ role: Role.SUPERVISOR, depotIds: [A, B] }, C)).toThrow(
      ForbiddenException,
    );
  });

  it('falls back to the token depot when the guard has not filled the set in', () => {
    expect(() => assertDepotAccess({ role: Role.KEPALA_DEPOT, depotId: A }, A)).not.toThrow();
    expect(() => assertDepotAccess({ role: Role.KEPALA_DEPOT, depotId: A }, B)).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a null resource depot for a scoped caller, and ignores unscoped ones', () => {
    expect(() => assertDepotAccess({ role: Role.SUPERVISOR, depotIds: [A] }, null)).toThrow(
      ForbiddenException,
    );
    expect(() => assertDepotAccess({ role: Role.HEAD_OFFICE, depotId: null }, null)).not.toThrow();
    expect(() => assertDepotAccess(undefined, C)).not.toThrow();
  });
});

describe('depotWhere', () => {
  it('builds an IN filter, or none at all for an unscoped caller', () => {
    expect(depotWhere([A, B])).toEqual({ in: [A, B] });
    expect(depotWhere(undefined)).toBeUndefined();
  });
});
