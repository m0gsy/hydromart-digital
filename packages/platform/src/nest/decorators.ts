import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';

import type { Capability } from '@hydromart/access';

import { AuthenticatedUser } from '../http/authenticated-user';
import { Role } from '../domain/role.enum';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const CAPABILITY_KEY = 'capability';

/** Marks a route public, bypassing the global JWT guard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a route to the given roles (enforced by RolesGuard). Accepts the Role
 * enum or plain role strings, so shared `@hydromart/access` CAPABILITIES tuples
 * (readonly string[]) can be spread directly: `@Roles(...CAPABILITIES.inventoryWrite)`.
 */
export const Roles = (...roles: (Role | string)[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Restricts a route to whoever holds `capability` RIGHT NOW.
 *
 * Replaces `@Roles(...CAPABILITIES.x)`, which froze the role list into route metadata
 * the moment the module was imported — so a super admin editing the matrix changed
 * nothing until the next deploy. This stores the capability NAME instead and lets
 * RolesGuard resolve it per request against the live map in @hydromart/access.
 *
 * `@Roles(...)` is untouched and still correct for a fixed set that is not a policy
 * decision (`@Roles(Role.CUSTOMER)` on a customer-only route, service-to-service pairs).
 */
export const Can = (capability: Capability): MethodDecorator & ClassDecorator =>
  SetMetadata(CAPABILITY_KEY, capability);

/** Injects the authenticated user (set by JwtAuthGuard) into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
  },
);
