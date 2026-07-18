import { ForbiddenException } from '@nestjs/common';

import { Role } from '../domain/role.enum';
import { depotScopeFilter } from './depot-scope';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('depotScopeFilter', () => {
  it('forces a locked role to its own depot, ignoring/allowing only its own request', () => {
    expect(depotScopeFilter({ role: Role.DEPOT_MANAGER, depotId: A })).toBe(A);
    expect(depotScopeFilter({ role: Role.DEPOT_OPERATOR, depotId: A }, A)).toBe(A);
  });

  it('forbids a locked role asking for another depot', () => {
    expect(() => depotScopeFilter({ role: Role.DEPOT_MANAGER, depotId: A }, B)).toThrow(
      ForbiddenException,
    );
  });

  it('forbids a locked role with no assigned depot', () => {
    expect(() => depotScopeFilter({ role: Role.DEPOT_MANAGER, depotId: null })).toThrow(
      ForbiddenException,
    );
  });

  it('lets bypass roles see all (undefined) or a requested depot', () => {
    expect(depotScopeFilter({ role: Role.HEAD_OFFICE, depotId: null })).toBeUndefined();
    expect(depotScopeFilter({ role: Role.SUPER_ADMIN, depotId: null }, B)).toBe(B);
    expect(depotScopeFilter(undefined)).toBeUndefined();
  });
});
