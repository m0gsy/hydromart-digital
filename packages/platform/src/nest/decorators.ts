import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';

import type { Capability } from '@hydromart/access';

import { AuthenticatedUser } from '../http/authenticated-user';
import { Role } from '../domain/role.enum';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const CAPABILITY_KEY = 'capability';
export const SELF_SCOPED_KEY = 'selfScoped';

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

/**
 * PLAT-1: declares that a route needs no role/capability check — either because it takes
 * `@CurrentUser()` and only ever acts on the caller's own identity, or because it takes no
 * subject at all and gives the same answer to any signed-in account (a public VAPID key, a
 * depot's payment info any customer may ask about).
 *
 * Without this, `RolesGuard` had no way to tell "nobody decorated this route" apart from
 * "this route was deliberately left open on purpose", and chose the safer-looking but wrong
 * default: no decorator meant no restriction, for every route, forever. `check-route-authz`
 * proved statically that today's undecorated routes are all one of the two shapes above —
 * but a static proof from THIS RUN says nothing about the next route somebody adds without
 * either `@Can`/`@Roles` or this. This decorator is what lets the guard refuse THAT one at
 * runtime instead of silently admitting it, while keeping every route this repo already
 * audited working exactly as before.
 *
 * `check-route-authz.mjs` requires this decorator wherever it also sees `@CurrentUser()`
 * (the parameter proves the code reads the subject from the token, this is what the guard
 * can see at runtime) OR wherever a `route-authz:` comment gives the no-subject reason.
 */
export const SelfScoped = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SELF_SCOPED_KEY, true);

/** Injects the authenticated user (set by JwtAuthGuard) into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
  },
);
