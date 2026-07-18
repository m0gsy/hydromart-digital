import { ForbiddenException } from '@nestjs/common';

import { Role } from '../domain/role.enum';
import { AuthenticatedUser } from '../http/authenticated-user';

/**
 * Roles locked to a single depot (their own `assignedDepotId`). Everyone else —
 * HEAD_OFFICE, FINANCE, MARKETING, SUPER_ADMIN (incl. the internal system principal),
 * plus customer/driver/franchise flows — is unaffected by depot-scope checks.
 */
export const DEPOT_LOCKED_ROLES: ReadonlySet<Role> = new Set([
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
]);

export function isDepotLocked(role: Role): boolean {
  return DEPOT_LOCKED_ROLES.has(role);
}

/**
 * Assert a caller may act on a resource that belongs to `resourceDepotId`.
 *
 * Complements DepotScopeGuard: the guard closes the LIST/enumeration vector (depotId in the
 * request), this closes the BY-ID vector — call it in a service/controller after loading a
 * row whose depot isn't in the request URL (e.g. `GET /order-disputes/:id`). For a
 * depot-locked role, the row's depot must equal the caller's own; otherwise Forbidden.
 * No-op for bypass roles and the system principal.
 */
export function assertDepotAccess(
  user: Pick<AuthenticatedUser, 'role' | 'depotId'> | undefined,
  resourceDepotId: string | null | undefined,
): void {
  if (!user || !isDepotLocked(user.role)) {
    return;
  }
  if (!user.depotId || user.depotId !== resourceDepotId) {
    throw new ForbiddenException('Akun ini hanya boleh mengakses depotnya sendiri.');
  }
}

/**
 * Assert a FRANCHISE_OWNER only touches a depot they OWN. Unlike depot staff (operator/
 * manager, handled by DepotScopeGuard/assertDepotAccess via the token's `depotId`), an
 * owner has no single assigned depot — they own a SET — so ownership can't be read from the
 * JWT. Call this after loading the depot's `ownerId`: for FRANCHISE_OWNER the depot's owner
 * must be the caller (`user.sub`); otherwise Forbidden. No-op for every other role (HQ,
 * finance, marketing, super-admin, system, and depot staff whose own guard already applies).
 *
 * Fail-closed: a null/unknown owner never matches, so an owner is denied a depot with no
 * recorded owner rather than granted it.
 */
export function assertDepotOwnership(
  user: Pick<AuthenticatedUser, 'role' | 'sub'> | undefined,
  depotOwnerId: string | null | undefined,
): void {
  if (!user || user.role !== Role.FRANCHISE_OWNER) {
    return;
  }
  if (!depotOwnerId || depotOwnerId !== user.sub) {
    throw new ForbiddenException('Akun waralaba ini hanya boleh mengakses depot miliknya.');
  }
}

/**
 * Resolve which depot a LIST query must be scoped to for the caller. Use on staff list
 * endpoints that carry no mandatory depotId param (e.g. `GET orders/manage`, `GET deliveries`)
 * so a depot-locked role only ever lists its OWN depot's rows — closing the list-without-filter
 * vector that DepotScopeGuard can't see (no depotId in the request to compare).
 *
 * - Depot-locked role (operator/manager): returns their own `depotId` (the query MUST filter by
 *   it). Throws if the account has no depot (fail-closed) or asked for a different depot. Rows
 *   with a null depot never match this filter → correctly invisible to locked staff (HQ-only).
 * - Everyone else (HQ/finance/marketing/super-admin, system): returns the requested depotId if
 *   given, else `undefined` (no filter — sees all depots).
 */
export function depotScopeFilter(
  user: Pick<AuthenticatedUser, 'role' | 'depotId'> | undefined,
  requestedDepotId?: string | null,
): string | undefined {
  if (!user || !isDepotLocked(user.role)) {
    return requestedDepotId ?? undefined;
  }
  if (!user.depotId) {
    throw new ForbiddenException('Akun ini belum terikat ke depot manapun.');
  }
  if (requestedDepotId && requestedDepotId !== user.depotId) {
    throw new ForbiddenException('Akun ini hanya boleh mengakses depotnya sendiri.');
  }
  return user.depotId;
}
