import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AuthenticatedUser } from '../http/authenticated-user';
import { Role } from '../domain/role.enum';
import {
  CAPABILITY_KEY,
  Can,
  CurrentUser,
  IS_PUBLIC_KEY,
  Public,
  ROLES_KEY,
  Roles,
} from './decorators';

/** Pull the factory Nest stored for a @CurrentUser() parameter and call it directly. */
function currentUserFactory(): (data: unknown, ctx: ExecutionContext) => AuthenticatedUser {
  class Probe {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    handler(@CurrentUser() _user: AuthenticatedUser): void {}
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => AuthenticatedUser }
  >;
  return Object.values(meta)[0].factory;
}

describe('route decorators', () => {
  it('@Public marks the handler so the JWT guard skips it', () => {
    class C {
      @Public()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      handler(): void {}
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, C.prototype.handler)).toBe(true);
  });

  // The spread form is why `Roles` takes plain strings: `@Roles(...CAPABILITIES.x)`
  // passes a readonly string[], not the Role enum.
  it('@Roles stores the list, enum or plain strings alike', () => {
    class C {
      @Roles(Role.MANAGER, 'HEAD_OFFICE')
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      handler(): void {}
    }
    expect(Reflect.getMetadata(ROLES_KEY, C.prototype.handler)).toEqual(['MANAGER', 'HEAD_OFFICE']);
  });

  // @Can stores the capability NAME, not the roles behind it — that is the whole
  // point, since the roles are resolved per request against the live matrix.
  it('@Can stores the capability name, not a frozen role list', () => {
    class C {
      @Can('inventoryWrite')
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      handler(): void {}
    }
    expect(Reflect.getMetadata(CAPABILITY_KEY, C.prototype.handler)).toBe('inventoryWrite');
    expect(Reflect.getMetadata(ROLES_KEY, C.prototype.handler)).toBeUndefined();
  });

  it('both work at class level too', () => {
    @Can('dashboard')
    @Roles(Role.SUPER_ADMIN)
    @Public()
    class C {}
    expect(Reflect.getMetadata(CAPABILITY_KEY, C)).toBe('dashboard');
    expect(Reflect.getMetadata(ROLES_KEY, C)).toEqual(['SUPER_ADMIN']);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, C)).toBe(true);
  });

  it('@CurrentUser hands back whatever JwtAuthGuard put on the request', () => {
    const user = { sub: 's1', role: Role.MANAGER, phone: null, depotId: 'd1' };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    expect(currentUserFactory()(undefined, ctx)).toBe(user);
  });

  // An unauthenticated request that somehow reaches a handler must produce undefined,
  // not throw inside the param factory where the error would be unattributable.
  it('@CurrentUser yields undefined on a request with no user', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(currentUserFactory()(undefined, ctx)).toBeUndefined();
  });
});
