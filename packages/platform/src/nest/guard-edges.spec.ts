import { ExecutionContext, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

import { SettingsCache, coerce } from '../config/settings';
import { Role } from '../domain/role.enum';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { CAPABILITY_KEY, ROLES_KEY, IS_PUBLIC_KEY } from './decorators';
import { DepotScopeGuard } from './depot-scope.guard';
import { INTERNAL_KEY_HEADER } from './internal-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { configureDepotScope, resetDepotScope } from './depot-scope-resolver';
import { depotScopeIds } from './depot-scope';
import { startCapabilityRefresh, resetCapabilityRefreshStatus } from './capability-refresh';

const KEY = 'internal-key-that-is-long-enough';

function ctxFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Cls {},
  } as unknown as ExecutionContext;
}

const reflectorReturning = (values: Record<string, unknown>): Reflector =>
  ({
    getAllAndOverride: (key: string) => values[key],
    get: (key: string) => values[key],
  }) as unknown as Reflector;

/**
 * The residual branches: each one is a path taken only in an unusual request, and
 * each is a way in or a way to be wrongly denied.
 */
describe('JwtAuthGuard edges', () => {
  const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
  const config = {
    get: () => KEY,
    getOrThrow: () => 'secret-long-enough-for-a-test-000000',
  } as unknown as ConfigService;

  it('lets a @Public route through without looking at a token at all', async () => {
    const guard = new JwtAuthGuard(reflectorReturning({ [IS_PUBLIC_KEY]: true }), jwt, config);
    expect(await guard.canActivate(ctxFor({ headers: {} }))).toBe(true);
  });

  // The internal key authenticates a machine AS SUPER_ADMIN, which is the strongest
  // grant in the system — it must only ever come from an exact-length exact match.
  it('authenticates the internal key as the system principal', async () => {
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, config);
    const request: Record<string, unknown> = { headers: { [INTERNAL_KEY_HEADER]: KEY } };
    expect(await guard.canActivate(ctxFor(request))).toBe(true);
    expect(request.user).toEqual({
      sub: 'system',
      role: Role.SUPER_ADMIN,
      phone: null,
      depotId: null,
    });
  });

  it('rejects a missing token', async () => {
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, config);
    await expect(guard.canActivate(ctxFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired or forged token without leaking why', async () => {
    (jwt.verifyAsync as jest.Mock).mockRejectedValue(new Error('jwt expired'));
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, config);
    await expect(
      guard.canActivate(ctxFor({ headers: { authorization: 'Bearer nope' } })),
    ).rejects.toThrow('Invalid or expired access token.');
  });

  // A service with no INTERNAL_SERVICE_KEY set must not treat "" as a match — every
  // header would then authenticate as SUPER_ADMIN.
  it('never honours the internal key when none is configured', async () => {
    const noKey = {
      get: () => undefined,
      getOrThrow: () => 'secret-long-enough-for-a-test-000000',
    } as unknown as ConfigService;
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, noKey);
    await expect(
      guard.canActivate(ctxFor({ headers: { [INTERNAL_KEY_HEADER]: '' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['a scheme with no value', 'Bearer'],
    ['a non-bearer scheme', 'Basic abc123'],
    ['an empty header', ''],
  ])('rejects %s', async (_case, authorization) => {
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, config);
    await expect(guard.canActivate(ctxFor({ headers: { authorization } }))).rejects.toThrow(
      'Missing bearer token.',
    );
  });

  it('accepts a lower-case bearer scheme', async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'c1',
      role: Role.CUSTOMER,
      phone: '+62',
      depotId: 'd1',
    });
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, config);
    expect(await guard.canActivate(ctxFor({ headers: { authorization: 'bearer ok' } }))).toBe(true);
  });

  it('defaults a token with no depot to null rather than undefined', async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 'c1',
      role: Role.CUSTOMER,
      phone: '+62',
    });
    const guard = new JwtAuthGuard(reflectorReturning({}), jwt, config);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer ok' } };
    await guard.canActivate(ctxFor(request));
    expect(request.user).toMatchObject({ depotId: null });
  });
});

describe('RolesGuard edges', () => {
  it('admits SUPER_ADMIN even for a capability nobody holds', () => {
    const guard = new RolesGuard(reflectorReturning({ [CAPABILITY_KEY]: 'accessMatrixWrite' }));
    expect(
      guard.canActivate(ctxFor({ user: { sub: 's', role: Role.SUPER_ADMIN } })),
    ).toBe(true);
  });

  // An empty @Roles() list is "no restriction declared", the same as no decorator —
  // the route is then guarded by whatever the class carries, or by nothing.
  it('treats an empty role list as an undecorated route', () => {
    const guard = new RolesGuard(reflectorReturning({ [ROLES_KEY]: [] }));
    expect(guard.canActivate(ctxFor({ user: { sub: 's', role: Role.MANAGER } }))).toBe(true);
  });

  it('denies a role outside a declared list', () => {
    const guard = new RolesGuard(reflectorReturning({ [ROLES_KEY]: [Role.FINANCE] }));
    expect(() => guard.canActivate(ctxFor({ user: { sub: 's', role: Role.MANAGER } }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('DepotScopeGuard edges', () => {
  afterEach(resetDepotScope);

  it('admits a supervisor asking for a depot inside their resolved set', async () => {
    configureDepotScope(async () => ['d1', 'd2']);
    const guard = new DepotScopeGuard(reflectorReturning({}));
    const request: Record<string, unknown> = {
      user: { sub: 'spv', role: Role.SUPERVISOR, depotId: null },
      params: { depotId: 'd2' },
      query: {},
      body: {},
    };
    expect(await guard.canActivate(ctxFor(request))).toBe(true);
  });
});

describe('depotScopeIds', () => {
  // An unscoped caller (HQ) who names a depot gets that depot, not "everything".
  it('narrows an unscoped role to the depot it explicitly asked for', () => {
    expect(depotScopeIds({ role: Role.HEAD_OFFICE, depotId: null }, 'd9')).toEqual(['d9']);
  });

  it('leaves an unscoped role unfiltered when it asks for nothing', () => {
    expect(depotScopeIds({ role: Role.HEAD_OFFICE, depotId: null })).toBeUndefined();
  });
});

describe('AllExceptionsFilter message fallback', () => {
  it('uses the exception message when the response object carries none', () => {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ url: '/x', method: 'GET' }),
      }),
    } as unknown as import('@nestjs/common').ArgumentsHost;
    new AllExceptionsFilter().catch(new HttpException({ error: 'Conflict' }, 409), host);
    expect((json.mock.calls[0][0] as { message: string }).message).toBe(
      'Http Exception',
    );
  });
});

describe('settings cache', () => {
  it('reads a raw value straight out of the snapshot', async () => {
    const cache = new SettingsCache({
      loadAll: async () => [
        { scope: 'GLOBAL', depotId: null, key: 'gallonDepositIdr', value: '20000' },
        { scope: 'DEPOT', depotId: 'd1', key: 'gallonDepositIdr', value: '15000' },
      ],
    });
    await cache.refresh();
    expect(cache.getRaw('gallonDepositIdr', 'd1')).toBe('15000');
    expect(cache.getRaw('gallonDepositIdr', null)).toBe('20000');
    expect(cache.getRaw('missing', null)).toBeNull();
    expect(cache.ttl).toBe(30_000);
  });

  // A garbage stored value must not become a silent 0 anywhere it can be avoided.
  it('coerces a non-numeric stored value to 0 rather than NaN', () => {
    expect(coerce('not-a-number', 'money')).toBe(0);
    expect(coerce('12.7', 'int')).toBe(12);
    expect(coerce('12.7', 'number')).toBe(12.7);
    expect(coerce('anything', 'string')).toBe('anything');
  });
});

describe('capability refresh recovery', () => {
  afterEach(resetCapabilityRefreshStatus);

  // A recovery line matters as much as the failure line: without it a log reader
  // cannot tell an outage that ended from one still running.
  it('logs once when the source comes back after failing', async () => {
    const logger = { log: jest.fn(), warn: jest.fn() };
    let fail = false;
    const stop = startCapabilityRefresh(
      async () => {
        if (fail) throw new Error('down');
        return {};
      },
      { ttlMs: 2, logger },
    );
    await new Promise((r) => setTimeout(r, 8));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Capability matrix loaded'));

    fail = true;
    await new Promise((r) => setTimeout(r, 8));
    expect(logger.warn).toHaveBeenCalledTimes(1);

    fail = false;
    await new Promise((r) => setTimeout(r, 8));
    stop();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('refreshed again'));
  });
});
