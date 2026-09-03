import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import {
  InternalAuthGuard,
  INTERNAL_KEY_HEADER,
} from '../../src/common/guards/internal-auth.guard';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { Role } from '../../src/domain/customer/role.enum';
import { buildTestConfig } from '../support/fakes';

/** Minimal ExecutionContext wrapping a fake request. */
function contextFor(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const config = buildTestConfig();

  function guardWith(reflectorValue: boolean | undefined, jwt: Partial<JwtService>): JwtAuthGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(reflectorValue),
    } as unknown as Reflector;
    return new JwtAuthGuard(reflector, jwt as JwtService, config);
  }

  it('short-circuits for @Public() routes', async () => {
    const guard = guardWith(true, { verifyAsync: jest.fn() });
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects a request with no Authorization header', async () => {
    const guard = guardWith(false, { verifyAsync: jest.fn() });
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a non-bearer Authorization scheme', async () => {
    const guard = guardWith(false, { verifyAsync: jest.fn() });
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a bearer scheme with no token value', async () => {
    const guard = guardWith(false, { verifyAsync: jest.fn() });
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid token and attaches the identity', async () => {
    const verifyAsync = jest
      .fn()
      .mockResolvedValue({ sub: 'c1', role: Role.CUSTOMER, phone: '+62811', exp: 1 });
    const guard = guardWith(false, { verifyAsync });
    const request: Partial<Request> = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect((request as { user?: unknown }).user).toEqual({
      sub: 'c1',
      role: Role.CUSTOMER,
      phone: '+62811',
      depotId: null,
    });
  });

  /**
   * `session.service.ts` signs `depotId` into every access token and this guard dropped it
   * when rebuilding `request.user`, which left auth-service's own DepotScopeGuard half
   * dead: `own` resolved to `[]` for everyone, so a depot-locked role sending `?depotId=`
   * was refused its own depot. Every other service carries the claim through.
   */
  it('carries the depot claim through, so DepotScopeGuard can resolve `own`', async () => {
    const verifyAsync = jest
      .fn()
      .mockResolvedValue({
        sub: 'c1',
        role: Role.STAFF_DEPOT,
        phone: '+62811',
        depotId: 'depot-9',
        exp: 1,
      });
    const guard = guardWith(false, { verifyAsync });
    const request: Partial<Request> = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect((request as { user?: { depotId?: string | null } }).user?.depotId).toBe('depot-9');
  });

  it('rejects an invalid/expired token', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('bad signature'));
    const guard = guardWith(false, { verifyAsync });
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer expired' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('InternalAuthGuard', () => {
  const KEY = 'shared-internal-service-key';

  function guardWith(configuredKey: string): InternalAuthGuard {
    return new InternalAuthGuard(buildTestConfig({ INTERNAL_SERVICE_KEY: configuredKey }));
  }

  it('accepts a request carrying the correct internal key', () => {
    const ctx = contextFor({ headers: { [INTERNAL_KEY_HEADER]: KEY } });
    expect(guardWith(KEY).canActivate(ctx)).toBe(true);
  });

  it('rejects a missing internal key header', () => {
    const ctx = contextFor({ headers: {} });
    expect(() => guardWith(KEY).canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a non-string internal key header', () => {
    const ctx = contextFor({ headers: { [INTERNAL_KEY_HEADER]: ['a', 'b'] } });
    expect(() => guardWith(KEY).canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key of a different length', () => {
    const ctx = contextFor({ headers: { [INTERNAL_KEY_HEADER]: 'too-short' } });
    expect(() => guardWith(KEY).canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key of the same length (timing-safe compare)', () => {
    const wrong = 'x'.repeat(KEY.length);
    const ctx = contextFor({ headers: { [INTERNAL_KEY_HEADER]: wrong } });
    expect(() => guardWith(KEY).canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('fails closed when no internal key is configured', () => {
    const ctx = contextFor({ headers: { [INTERNAL_KEY_HEADER]: 'anything' } });
    expect(() => guardWith('').canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
