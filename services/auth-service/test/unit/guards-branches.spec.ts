import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { InternalAuthGuard, INTERNAL_KEY_HEADER } from '../../src/common/guards/internal-auth.guard';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
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
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(reflectorValue) } as unknown as Reflector;
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
    const verifyAsync = jest.fn().mockResolvedValue({ sub: 'c1', role: Role.CUSTOMER, phone: '+62811', exp: 1 });
    const guard = guardWith(false, { verifyAsync });
    const request: Partial<Request> = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect((request as { user?: unknown }).user).toEqual({ sub: 'c1', role: Role.CUSTOMER, phone: '+62811' });
  });

  it('rejects an invalid/expired token', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('bad signature'));
    const guard = guardWith(false, { verifyAsync });
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer expired' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  function guardWith(required: Role[] | undefined): RolesGuard {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows a route with no @Roles restriction', () => {
    expect(guardWith(undefined).canActivate(contextFor({}))).toBe(true);
  });

  it('allows a route with an empty @Roles list', () => {
    expect(guardWith([]).canActivate(contextFor({}))).toBe(true);
  });

  it('rejects an unauthenticated request against a restricted route', () => {
    const ctx = contextFor({ user: undefined } as Partial<Request>);
    expect(() => guardWith([Role.HEAD_OFFICE]).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a user without the required role', () => {
    const ctx = contextFor({ user: { sub: 'c1', role: Role.CUSTOMER, phone: '+62' } } as Partial<Request>);
    expect(() => guardWith([Role.HEAD_OFFICE]).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows a user holding the required role', () => {
    const ctx = contextFor({ user: { sub: 'c1', role: Role.HEAD_OFFICE, phone: '+62' } } as Partial<Request>);
    expect(guardWith([Role.HEAD_OFFICE]).canActivate(ctx)).toBe(true);
  });

  it('lets SUPER_ADMIN bypass every restriction', () => {
    const ctx = contextFor({ user: { sub: 'c1', role: Role.SUPER_ADMIN, phone: '+62' } } as Partial<Request>);
    expect(guardWith([Role.HEAD_OFFICE]).canActivate(ctx)).toBe(true);
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
