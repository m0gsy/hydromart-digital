import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '../src/domain/role.enum';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../src/nest/decorators';
import { RolesGuard } from '../src/nest/roles.guard';

function makeGuard(meta: { isPublic?: boolean; roles?: readonly string[] }): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: unknown) =>
      key === IS_PUBLIC_KEY ? (meta.isPublic ?? false) : meta.roles,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function makeContext(user?: { role: Role }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows a caller holding a required role', () => {
    const guard = makeGuard({ roles: [Role.FINANCE] });
    expect(guard.canActivate(makeContext({ role: Role.FINANCE }))).toBe(true);
  });

  it('rejects a caller without a required role', () => {
    const guard = makeGuard({ roles: [Role.FINANCE] });
    expect(() => guard.canActivate(makeContext({ role: Role.DRIVER }))).toThrow(ForbiddenException);
  });

  it('allows a route with no @Roles decorator', () => {
    const guard = makeGuard({});
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  // Regression: a @Public() service-to-service handler inside a @Roles() controller has
  // no request.user (JwtAuthGuard skipped it), so inheriting the class roles 403'd every
  // internal push — e.g. delivery-service's courier earning event, which fails open.
  it('skips an inherited @Roles on a @Public() handler', () => {
    const guard = makeGuard({ isPublic: true, roles: [Role.DRIVER] });
    expect(guard.canActivate(makeContext())).toBe(true);
  });
});
