import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '../domain/role.enum';
import { DepotScopeGuard } from './depot-scope.guard';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';

function ctx(
  user: unknown,
  req: { query?: unknown; body?: unknown; params?: unknown } = {},
  isPublic = false,
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  const request = { user, query: req.query ?? {}, body: req.body ?? {}, params: req.params ?? {} };
  const context = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('DepotScopeGuard', () => {
  const run = (user: unknown, req: Parameters<typeof ctx>[1] = {}, isPublic = false) => {
    const { context, reflector } = ctx(user, req, isPublic);
    return new DepotScopeGuard(reflector).canActivate(context);
  };

  it('allows a depot manager querying their OWN depot', () => {
    expect(run({ role: Role.DEPOT_MANAGER, depotId: DEPOT_A }, { query: { depotId: DEPOT_A } })).toBe(true);
  });

  it('forbids a depot manager querying ANOTHER depot', () => {
    expect(() => run({ role: Role.DEPOT_MANAGER, depotId: DEPOT_A }, { query: { depotId: DEPOT_B } })).toThrow(
      ForbiddenException,
    );
  });

  it('forbids a depot operator with no assigned depot from any depot query', () => {
    expect(() => run({ role: Role.DEPOT_OPERATOR, depotId: null }, { body: { depotId: DEPOT_A } })).toThrow(
      ForbiddenException,
    );
  });

  it('lets bypass roles (HEAD_OFFICE) read any depot', () => {
    expect(run({ role: Role.HEAD_OFFICE, depotId: null }, { query: { depotId: DEPOT_B } })).toBe(true);
    expect(run({ role: Role.SUPER_ADMIN, depotId: null }, { query: { depotId: DEPOT_B } })).toBe(true);
    expect(run({ role: Role.FINANCE, depotId: null }, { query: { depotId: DEPOT_B } })).toBe(true);
    expect(run({ role: Role.MARKETING, depotId: null }, { query: { depotId: DEPOT_B } })).toBe(true);
  });

  it('allows a locked role on requests that carry no depotId (by-id paths guarded in-service)', () => {
    expect(run({ role: Role.DEPOT_MANAGER, depotId: DEPOT_A }, { params: { id: 'x' } })).toBe(true);
  });

  it('skips public routes and missing identity', () => {
    expect(run({ role: Role.DEPOT_MANAGER, depotId: DEPOT_A }, { query: { depotId: DEPOT_B } }, true)).toBe(true);
    expect(run(undefined, { query: { depotId: DEPOT_B } })).toBe(true);
  });

  it('reads depotId from route params too (path-scoped endpoints)', () => {
    expect(() => run({ role: Role.DEPOT_MANAGER, depotId: DEPOT_A }, { params: { depotId: DEPOT_B } })).toThrow(
      ForbiddenException,
    );
  });
});
