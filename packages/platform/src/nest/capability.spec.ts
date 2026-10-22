import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  can,
  currentCustomRoles,
  currentDepotOverrides,
  currentRoleSettings,
  loadCustomRoles,
  loadDepotOverrides,
  loadOverrides,
  loadRoleSettings,
} from '@hydromart/access';

import { Role } from '../domain/role.enum';
import { assertCapability } from './capability';
import { startCapabilityRefresh } from './capability-refresh';
import { CAPABILITY_KEY, ROLES_KEY, IS_PUBLIC_KEY, SELF_SCOPED_KEY } from './decorators';
import { RolesGuard } from './roles.guard';

afterEach(() => {
  loadOverrides({});
  loadCustomRoles([]);
  loadDepotOverrides([]);
  loadRoleSettings([]);
});

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
  // PLAT-1: neither decorator used to mean no restriction — the same shape as a route
  // nobody remembered to decorate. Refused now, unless @SelfScoped() says otherwise.
  it('refuses a route with neither decorator', () => {
    const ctx = contextWith({}, {}, { role: 'CUSTOMER' });
    expect(() => guardFor(ctx).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows a route with @SelfScoped() and neither @Can nor @Roles', () => {
    const ctx = contextWith({ [SELF_SCOPED_KEY]: true }, {}, { role: 'CUSTOMER' });
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

  /*
   * PLAT-6. The note above this code promised "for up to one TTL after an outage a revoked
   * permission may still work", and the code did not keep it: a source down for a week
   * served the week-old snapshot for a week. A permission revoked because somebody should
   * no longer hold it is precisely the case where an outage must not extend it forever.
   */
  it('drops a snapshot that outlived its source, back to the compiled defaults', async () => {
    const warn = jest.fn();
    let mode: 'ok' | 'fail' = 'ok';
    const stop = startCapabilityRefresh(
      async () => {
        if (mode === 'fail') throw new Error('down');
        return { approvals: ['SUPERVISOR'] };
      },
      { ttlMs: 5, maxStaleMs: 30, logger: { warn } },
    );
    await tick(20);
    expect(assertPasses('approvals', 'SUPERVISOR')).toBe(true);

    mode = 'fail';
    await tick(80);

    // The override is gone; what is left is the policy the binary shipped with.
    expect(assertPasses('approvals', 'SUPERVISOR')).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('stale'))).toBe(true);
    stop();
  });

  // Nothing to drop: a source that has never answered is already serving the defaults.
  it('says nothing about staleness when there was no snapshot to begin with', async () => {
    const warn = jest.fn();
    const stop = startCapabilityRefresh(
      async () => {
        throw new Error('down');
      },
      { ttlMs: 5, maxStaleMs: 10, logger: { warn } },
    );
    await tick(40);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('stale'))).toBe(false);
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

describe('a per-depot DENY survives an outage', () => {
  it('keeps the DENY (and expires only the matrix grant) after the source stays down', async () => {
    const D2 = '22222222-2222-2222-2222-222222222222';
    const warn = jest.fn();
    let mode: 'ok' | 'fail' = 'ok';
    const stop = startCapabilityRefresh(
      async () => {
        if (mode === 'fail') throw new Error('down');
        return {
          overrides: { approvals: ['SUPERVISOR'] },
          customRoles: [],
          depotOverrides: [{ capability: 'approvals', roleKey: 'SUPERVISOR', depotId: D2, effect: 'DENY' as const }],
        };
      },
      { ttlMs: 5, maxStaleMs: 30, logger: { warn } },
    );
    await tick(20);
    expect(can('approvals', 'SUPERVISOR')).toBe(true);
    expect(can('approvals', 'SUPERVISOR', [D2])).toBe(false);
    mode = 'fail';
    await tick(80);
    expect(can('approvals', 'SUPERVISOR')).toBe(false);
    expect(currentDepotOverrides()).toHaveLength(1);
    expect(can('approvals', 'SUPERVISOR', [D2])).toBe(false);
    stop();
  });
});

describe('startCapabilityRefresh with custom roles, depot exceptions and role settings', () => {
  const D = '11111111-1111-1111-1111-111111111111';
  const full = async () => ({
    overrides: {},
    customRoles: [{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' as const }],
    depotOverrides: [{ capability: 'dashboard', roleKey: 'C_kasir', depotId: D, effect: 'GRANT' as const }],
    roleSettings: [{ roleKey: 'HR', disabled: true }],
  });

  it('loads all of it, and keeps it across later ticks', async () => {
    const stop = startCapabilityRefresh(full, { ttlMs: 5 });
    await tick(30);
    expect(currentCustomRoles()).toHaveLength(1);
    expect(currentDepotOverrides()).toHaveLength(1);
    expect(currentRoleSettings()).toHaveLength(1);
    expect(can('dashboard', 'C_kasir', [D])).toBe(true);
    stop();
  });

  it('a bare patch source reads as none, which is why auth-service must not feed one', async () => {
    const stop = startCapabilityRefresh(full, { ttlMs: 5 });
    await tick(20);
    stop();
    const stop2 = startCapabilityRefresh(async () => ({}), { ttlMs: 5 });
    await tick(20);
    expect(currentCustomRoles()).toHaveLength(0);
    stop2();
  });

  it('on expiry withdraws what WIDENS access and keeps what NARROWS it', async () => {
    const warn = jest.fn();
    let mode: 'ok' | 'fail' = 'ok';
    const stop = startCapabilityRefresh(
      async () => {
        if (mode === 'fail') throw new Error('down');
        return full();
      },
      { ttlMs: 5, maxStaleMs: 30, logger: { warn } },
    );
    await tick(20);
    expect(can('dashboard', 'C_kasir', [D])).toBe(true);
    mode = 'fail';
    await tick(80);
    // The per-depot GRANT is gone, so the custom role holds nothing; but the role still exists with
    // its LOCKED scope, and the switched-off HR role stays switched off.
    expect(currentDepotOverrides()).toHaveLength(0);
    expect(can('dashboard', 'C_kasir', [D])).toBe(false);
    expect(currentCustomRoles()).toHaveLength(1);
    expect(currentRoleSettings()).toHaveLength(1);
    expect(can('orderQueue', 'HR')).toBe(false);
    const msg = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('stale')) ?? '';
    expect(msg).toContain('1 per-depot GRANT(s)');
    expect(msg).toContain('keeping every DENY');
    stop();
  });

  it('warns once when the payload carried rows it could not read, and again only if that changes', async () => {
    const warn = jest.fn();
    let dropped = 2;
    const stop = startCapabilityRefresh(async () => ({ ...(await full()), dropped }), {
      ttlMs: 5,
      logger: { warn },
    });
    await tick(40);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('malformed'))).toHaveLength(1);
    dropped = 0;
    await tick(30);
    dropped = 5;
    await tick(30);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('malformed'))).toHaveLength(2);
    stop();
  });
});
