import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { loadOverrides } from '@hydromart/access';

import { Role } from '../domain/role.enum';
import { assertCapability } from './capability';
import { startCapabilityRefresh } from './capability-refresh';
import { CAPABILITY_KEY, ROLES_KEY, IS_PUBLIC_KEY } from './decorators';
import { RolesGuard } from './roles.guard';

afterEach(() => loadOverrides({}));

/** Context whose handler/class metadata is whatever the two maps say. */
function contextWith(
  handler: Record<string, unknown>,
  cls: Record<string, unknown>,
  user?: { role: string },
): ExecutionContext {
  const h = { name: 'handler' };
  const c = { name: 'class' };
  const reflector = {
    get: (key: string, target: unknown) => (target === h ? handler[key] : cls[key]),
    getAllAndOverride: (key: string) => handler[key] ?? cls[key],
  } as unknown as Reflector;
  const ctx = {
    getHandler: () => h,
    getClass: () => c,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return Object.assign(ctx, { __reflector: reflector }) as ExecutionContext;
}

function guardFor(ctx: ExecutionContext): RolesGuard {
  return new RolesGuard((ctx as unknown as { __reflector: Reflector }).__reflector);
}

describe('RolesGuard capability path', () => {
  it('allows a route with neither decorator', () => {
    const ctx = contextWith({}, {}, { role: 'CUSTOMER' });
    expect(guardFor(ctx).canActivate(ctx)).toBe(true);
  });

  it('skips a @Public() route even when the class carries a capability', () => {
    const ctx = contextWith({ [IS_PUBLIC_KEY]: true }, { [CAPABILITY_KEY]: 'approvals' });
    expect(guardFor(ctx).canActivate(ctx)).toBe(true);
  });

  it('resolves @Can against the LIVE matrix, not the compiled one', () => {
    const ctx = contextWith({ [CAPABILITY_KEY]: 'approvals' }, {}, { role: 'SUPERVISOR' });
    expect(() => guardFor(ctx).canActivate(ctx)).toThrow(ForbiddenException);

    loadOverrides({ approvals: ['SUPERVISOR'] });
    const after = contextWith({ [CAPABILITY_KEY]: 'approvals' }, {}, { role: 'SUPERVISOR' });
    expect(guardFor(after).canActivate(after)).toBe(true);
  });

  it('still enforces a literal @Roles list', () => {
    const ok = contextWith({ [ROLES_KEY]: ['HEAD_OFFICE'] }, {}, { role: 'HEAD_OFFICE' });
    expect(guardFor(ok).canActivate(ok)).toBe(true);
    const no = contextWith({ [ROLES_KEY]: ['HEAD_OFFICE'] }, {}, { role: 'CUSTOMER' });
    expect(() => guardFor(no).canActivate(no)).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request against a guarded route', () => {
    const ctx = contextWith({ [CAPABILITY_KEY]: 'approvals' }, {});
    expect(() => guardFor(ctx).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('lets SUPER_ADMIN through both paths', () => {
    const a = contextWith({ [CAPABILITY_KEY]: 'approvals' }, {}, { role: 'SUPER_ADMIN' });
    expect(guardFor(a).canActivate(a)).toBe(true);
    const b = contextWith({ [ROLES_KEY]: ['HEAD_OFFICE'] }, {}, { role: 'SUPER_ADMIN' });
    expect(guardFor(b).canActivate(b)).toBe(true);
  });

  // The failure this guard is shaped to avoid: a broad class-level decorator quietly
  // overruling the narrower one written on the handler.
  describe('handler wins over class', () => {
    it('method @Roles beats a class @Can', () => {
      const ctx = contextWith(
        { [ROLES_KEY]: ['CUSTOMER'] },
        { [CAPABILITY_KEY]: 'approvals' },
        { role: 'CUSTOMER' },
      );
      expect(guardFor(ctx).canActivate(ctx)).toBe(true);
    });

    it('method @Can beats a class @Roles', () => {
      const ctx = contextWith(
        { [CAPABILITY_KEY]: 'approvals' },
        { [ROLES_KEY]: ['CUSTOMER'] },
        { role: 'CUSTOMER' },
      );
      expect(() => guardFor(ctx).canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('an undecorated handler inherits the class capability', () => {
      const ctx = contextWith({}, { [CAPABILITY_KEY]: 'approvals' }, { role: 'MANAGER' });
      expect(guardFor(ctx).canActivate(ctx)).toBe(true);
    });

    it('an empty method @Roles list falls through to the class', () => {
      const ctx = contextWith(
        { [ROLES_KEY]: [] },
        { [CAPABILITY_KEY]: 'approvals' },
        { role: 'CUSTOMER' },
      );
      expect(() => guardFor(ctx).canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});

describe('assertCapability', () => {
  it('passes a holder and rejects everyone else', () => {
    expect(() => assertCapability({ role: Role.SUPER_ADMIN }, 'settingsGlobal')).not.toThrow();
    expect(() => assertCapability({ role: Role.MANAGER }, 'settingsGlobal')).toThrow(
      ForbiddenException,
    );
    expect(() => assertCapability(undefined, 'settingsGlobal')).toThrow(ForbiddenException);
  });

  it('follows an override', () => {
    loadOverrides({ settingsGlobal: ['HEAD_OFFICE'] });
    expect(() => assertCapability({ role: Role.HEAD_OFFICE }, 'settingsGlobal')).not.toThrow();
  });
});

describe('startCapabilityRefresh', () => {
  it('loads the patch on the first tick', async () => {
    const stop = startCapabilityRefresh(async () => ({ approvals: ['SUPERVISOR'] }));
    await Promise.resolve();
    await Promise.resolve();
    expect(assertPasses('approvals', 'SUPERVISOR')).toBe(true);
    stop();
  });

  it('keeps the last good snapshot when the source fails, and warns once per streak', async () => {
    const warn = jest.fn();
    let mode: 'ok' | 'fail' = 'ok';
    const stop = startCapabilityRefresh(
      async () => {
        if (mode === 'fail') throw new Error('down');
        return { approvals: ['SUPERVISOR'] };
      },
      { ttlMs: 5, logger: { warn } },
    );
    await tick(20);
    mode = 'fail';
    await tick(40);

    // Still serving the last known matrix — a source outage must not revoke access.
    expect(assertPasses('approvals', 'SUPERVISOR')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops polling once stopped', async () => {
    const load = jest.fn().mockResolvedValue({});
    const stop = startCapabilityRefresh(load, { ttlMs: 5 });
    await tick(20);
    stop();
    stop(); // idempotent
    const after = load.mock.calls.length;
    await tick(20);
    expect(load.mock.calls.length).toBe(after);
  });
});

function assertPasses(capability: string, role: string): boolean {
  try {
    assertCapability({ role: role as Role }, capability as never);
    return true;
  } catch {
    return false;
  }
}

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
