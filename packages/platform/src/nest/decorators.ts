import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';

import { AuthenticatedUser } from '../http/authenticated-user';
import { Role } from '../domain/role.enum';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marks a route public, bypassing the global JWT guard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a route to the given roles (enforced by RolesGuard). Accepts the Role
 * enum or plain role strings, so shared `@hydromart/access` CAPABILITIES tuples
 * (readonly string[]) can be spread directly: `@Roles(...CAPABILITIES.inventoryWrite)`.
 */
export const Roles = (...roles: (Role | string)[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated user (set by JwtAuthGuard) into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
  },
);
