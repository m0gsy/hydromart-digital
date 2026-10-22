import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { loadCustomRoles, loadDepotOverrides, loadOverrides, loadRoleSettings } from '@hydromart/access';

import { assertCapability } from './capability';
import { CAPABILITY_KEY, ROLES_KEY } from './decorators';
import { DepotScopeGuard } from './depot-scope.guard';
import { effectiveScope, isDepotLocked, isDepotResolved, isDepotScoped } from './depot-scope';
import { RolesGuard } from './roles.guard';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

afterEach(() => {
  loadOverrides({});
  loadCustomRoles([]);
  loadDepotOverrides([]);
  loadRoleSettings([]);
});

interface Req {
  user?: { role: string; depotId?: string; sub?: string };
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

function ctx(req: Req, capability = 'dashboard'): { c: ExecutionContext; r: Reflector } {
  const h = {};
  const k = {};
  const r = {
    get: (key: string, target: unknown) => (target === h && key === CAPABILITY_KEY ? capability : undefined),
    getAllAndOverride: () => undefined,
  } as unknown as Reflector;
  const c = {
    getHandler: () => h,
    getClass: () => k,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { c, r };
}

const run = (req: Req): boolean => {
  const { c, r } = ctx(req);
  return new RolesGuard(r).canActivate(c);
};

describe('custom role depot scope', () => {
  it('a built-in role is unaffected', () => {
    expect(isDepotLocked('STAFF_DEPOT')).toBe(true);
    expect(isDepotResolved('SUPERVISOR')).toBe(true);
    expect(isDepotScoped('HEAD_OFFICE')).toBe(false);
  });

  it('an unknown or archived custom role is LOCKED, never network-wide', () => {
    expect(isDepotLocked('C_ghost')).toBe(true);
    expect(isDepotScoped('C_ghost')).toBe(true);
  });

  it('a loaded custom role takes its declared scope', () => {
    loadCustomRoles([
      { key: 'C_l', name: 'l', scope: 'LOCKED' },
      { key: 'C_r', name: 'r', scope: 'RESOLVED' },
      { key: 'C_g', name: 'g', scope: 'GLOBAL' },
    ]);
    expect(isDepotLocked('C_l')).toBe(true);
    expect(isDepotResolved('C_r')).toBe(true);
    expect(isDepotScoped('C_g')).toBe(false);
  });
});

describe('RolesGuard with per-depot overrides', () => {
  beforeEach(() => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }]);
    loadDepotOverrides([{ capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'GRANT' }]);
  });

  it('a depot GRANT passes when the request names that depot', () => {
    expect(run({ user: { role: 'C_kasir', depotId: A }, query: { depotId: A } })).toBe(true);
  });

  it('a locked caller naming no depot acts at their own depot', () => {
    expect(run({ user: { role: 'C_kasir', depotId: A } })).toBe(true);
  });

  it('is refused at a depot with no grant', () => {
    expect(() => run({ user: { role: 'C_kasir', depotId: B }, query: { depotId: B } })).toThrow(
      ForbiddenException,
    );
  });

  it('a body or param depotId counts the same as a query one', () => {
    expect(run({ user: { role: 'C_kasir', depotId: A }, body: { depotId: A } })).toBe(true);
    expect(run({ user: { role: 'C_kasir', depotId: A }, params: { depotId: A } })).toBe(true);
    expect(() =>
      run({ user: { role: 'C_kasir', depotId: A }, query: { depotId: A }, params: { depotId: B } }),
    ).toThrow(ForbiddenException);
  });

  it('a GLOBAL custom role naming no depot gets only the global matrix', () => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'GLOBAL' }]);
    expect(() => run({ user: { role: 'C_kasir' } })).toThrow(ForbiddenException);
    loadOverrides({ dashboard: ['C_kasir'] });
    expect(run({ user: { role: 'C_kasir' } })).toBe(true);
  });

  it('a DENY wins over the global list', () => {
    loadOverrides({ dashboard: ['C_kasir'] });
    loadDepotOverrides([{ capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'DENY' }]);
    expect(() => run({ user: { role: 'C_kasir', depotId: A }, query: { depotId: A } })).toThrow(
      ForbiddenException,
    );
  });

  it('an archived role loses everything on the next refresh', () => {
    loadOverrides({ dashboard: ['C_kasir'] });
    loadCustomRoles([]);
    expect(() => run({ user: { role: 'C_kasir', depotId: A }, query: { depotId: A } })).toThrow(
      ForbiddenException,
    );
  });
});

describe('DepotScopeGuard still fences a forged depotId for a custom role', () => {
  it('refuses a depot outside the locked set', async () => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }]);
    const guard = new DepotScopeGuard({ getAllAndOverride: () => undefined } as unknown as Reflector);
    const mk = (depot: string): ExecutionContext =>
      ({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: 'C_kasir', depotId: A, sub: 'u' }, query: { depotId: depot } }),
        }),
      }) as unknown as ExecutionContext;
    await expect(guard.canActivate(mk(A))).resolves.toBe(true);
    await expect(guard.canActivate(mk(B))).rejects.toThrow(ForbiddenException);
  });
});

describe('assertCapability with a depot', () => {
  it('applies a per-depot grant and keeps the depot-less call global', () => {
    loadCustomRoles([{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }]);
    loadDepotOverrides([{ capability: 'dashboard', roleKey: 'C_kasir', depotId: A, effect: 'GRANT' }]);
    expect(() => assertCapability({ role: 'C_kasir' } as never, 'dashboard', A)).not.toThrow();
    expect(() => assertCapability({ role: 'C_kasir' } as never, 'dashboard', B)).toThrow(ForbiddenException);
    expect(() => assertCapability({ role: 'C_kasir' } as never, 'dashboard')).toThrow(ForbiddenException);
    expect(() => assertCapability({ role: 'C_kasir' } as never, 'dashboard', null)).toThrow(ForbiddenException);
  });
});

describe('scope setting on a built-in role', () => {
  it('replaces the compiled reach, and fixed roles ignore it', () => {
    expect(effectiveScope('MANAGER')).toBe('RESOLVED');
    expect(effectiveScope('HR')).toBe('GLOBAL');
    loadRoleSettings([
      { roleKey: 'MANAGER', scope: 'LOCKED' },
      { roleKey: 'HR', scope: 'RESOLVED' },
      { roleKey: 'STAFF_DEPOT', scope: 'GLOBAL' },
      { roleKey: 'FRANCHISE_OWNER', scope: 'LOCKED' },
    ]);
    expect(effectiveScope('MANAGER')).toBe('LOCKED');
    expect(isDepotResolved('HR')).toBe(true);
    expect(isDepotScoped('STAFF_DEPOT')).toBe(false);
    expect(effectiveScope('FRANCHISE_OWNER')).toBe('GLOBAL');
  });

  it('a disabled built-in role also fails a literal @Roles route', () => {
    const h = {};
    const reflector = {
      get: (key: string, target: unknown) => (target === h && key === ROLES_KEY ? ['STAFF_DEPOT'] : undefined),
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const ctx = {
      getHandler: () => h,
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'STAFF_DEPOT', depotId: A } }) }),
    } as unknown as ExecutionContext;
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
    loadRoleSettings([{ roleKey: 'STAFF_DEPOT', disabled: true }]);
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('a role string this build does not know is LOCKED, never network-wide', () => {
    expect(effectiveScope('WIZARD')).toBe('LOCKED');
    expect(isDepotScoped('WIZARD')).toBe(true);
    expect(effectiveScope('HEAD_OFFICE')).toBe('GLOBAL');
  });

  it('a disabled role fails the RolesGuard outright', () => {
    loadOverrides({ dashboard: ['HR'] });
    expect(run({ user: { role: 'HR' } })).toBe(true);
    loadRoleSettings([{ roleKey: 'HR', disabled: true }]);
    expect(() => run({ user: { role: 'HR' } })).toThrow(ForbiddenException);
  });
});
