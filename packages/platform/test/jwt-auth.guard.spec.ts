import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { Role } from '../src/domain/role.enum';
import { JwtAuthGuard } from '../src/nest/jwt-auth.guard';

const SECRET = 'test-jwt-access-secret-at-least-32-chars-long';
const INTERNAL_KEY = 'super-secret-internal-service-key';

// Non-public reflector: exercises the token/internal-key branches, never @Public().
const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

function makeConfig(internalKey: string): ConfigService {
  return {
    get: (key: string) => (key === 'INTERNAL_SERVICE_KEY' ? internalKey : undefined),
    getOrThrow: (key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return SECRET;
      throw new Error(`unexpected getOrThrow(${key})`);
    },
  } as unknown as ConfigService;
}

function makeContext(headers: Record<string, string | undefined>): {
  ctx: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = { headers };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtAuthGuard internal-key + bearer auth', () => {
  const jwt = new JwtService();

  it('(a) accepts a valid x-internal-key as the SUPER_ADMIN system principal', async () => {
    const guard = new JwtAuthGuard(reflector, jwt, makeConfig(INTERNAL_KEY));
    const { ctx, request } = makeContext({ 'x-internal-key': INTERNAL_KEY });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ sub: 'system', role: Role.SUPER_ADMIN, phone: null });
  });

  it('(b) rejects a wrong internal key with no bearer token', async () => {
    const guard = new JwtAuthGuard(reflector, jwt, makeConfig(INTERNAL_KEY));
    const { ctx } = makeContext({ 'x-internal-key': 'wrong-key' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(b) rejects an absent internal key with no bearer token', async () => {
    const guard = new JwtAuthGuard(reflector, jwt, makeConfig(INTERNAL_KEY));
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(c) still verifies a valid bearer JWT and attaches the real user', async () => {
    const guard = new JwtAuthGuard(reflector, jwt, makeConfig(INTERNAL_KEY));
    const token = await jwt.signAsync(
      { sub: 'user-42', role: Role.FRANCHISE_OWNER, phone: '+628123' },
      { secret: SECRET },
    );
    const { ctx, request } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({ sub: 'user-42', role: Role.FRANCHISE_OWNER });
  });

  it('(d) does not accept an internal key when the configured key is empty', async () => {
    const guard = new JwtAuthGuard(reflector, jwt, makeConfig(''));
    // Header equals the empty configured value — must still be rejected (fail closed).
    const { ctx } = makeContext({ 'x-internal-key': '' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
