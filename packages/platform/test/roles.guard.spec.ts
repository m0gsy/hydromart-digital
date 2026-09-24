import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '../src/domain/role.enum';
import { IS_PUBLIC_KEY, ROLES_KEY, SELF_SCOPED_KEY } from '../src/nest/decorators';
import { RolesGuard } from '../src/nest/roles.guard';

// The guard reads @Public() with getAllAndOverride (handler-or-class is enough there)
// but resolves the role/capability pair with get(), handler first, so a class-level
// decorator cannot overrule a narrower one on the method.
function makeGuard(meta: {
  isPublic?: boolean;
  roles?: readonly string[];
  selfScoped?: boolean;
}): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: unknown) =>
      key === IS_PUBLIC_KEY ? (meta.isPublic ?? false) : meta.roles,
    get: (key: unknown) => {
      if (key === ROLES_KEY) return meta.roles;
      if (key === SELF_SCOPED_KEY) return meta.selfScoped;
      return undefined;
    },
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
    expect(() => guard.canActivate(makeContext({ role: Role.STAFF_DEPOT }))).toThrow(ForbiddenException);
  });

  // PLAT-1: no decorator at all used to mean no restriction, which is indistinguishable
  // from a route nobody remembered to decorate. Refused now, unless @SelfScoped() says
  // this one really is meant to be open to any signed-in account.
  it('refuses a route with no @Roles/@Can/@SelfScoped decorator', () => {
    const guard = makeGuard({});
    expect(() => guard.canActivate(makeContext({ role: Role.CUSTOMER }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a route with @SelfScoped() and no role/capability', () => {
    const guard = makeGuard({ selfScoped: true });
    expect(guard.canActivate(makeContext({ role: Role.CUSTOMER }))).toBe(true);
  });

  // Regression: a @Public() service-to-service handler inside a @Roles() controller has
  // no request.user (JwtAuthGuard skipped it), so inheriting the class roles 403'd every
  // internal push — e.g. delivery-service's courier earning event, which fails open.
  it('skips an inherited @Roles on a @Public() handler', () => {
    const guard = makeGuard({ isPublic: true, roles: [Role.STAFF_DEPOT] });
    expect(guard.canActivate(makeContext())).toBe(true);
  });
});
