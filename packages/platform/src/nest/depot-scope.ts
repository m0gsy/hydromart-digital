import { ForbiddenException } from '@nestjs/common';

import { Role } from '../domain/role.enum';
import { AuthenticatedUser } from '../http/authenticated-user';

/**
 * Roles locked to a SINGLE depot — their own `assignedDepotId`, straight off the access
 * token with no lookup.
 *
 * STAFF_DEPOT is locked even though its predecessor DRIVER was not: depot staff belong to
 * one depot. An account in this set with no depot fails closed.
 */
export const DEPOT_LOCKED_ROLES: ReadonlySet<Role> = new Set([Role.STAFF_DEPOT, Role.KEPALA_DEPOT]);

/**
 * Roles whose depots are a RESOLVED SET rather than a single token claim: the supervision
 * chain: an assistant supervisor covers many depots, a supervisor covers their assistants',
 * a manager covers their supervisors'.
 *
 * FRANCHISE_OWNER is deliberately NOT here. An owner's depots come from Depot.ownerId,
 * checked by assertDepotOwnership against the row itself — stronger than set membership.
 * Resolving them here too would add a second, weaker path and a failure mode they do not
 * need.
 *
 * A set is too large and too mutable to live in a JWT, so DepotScopeGuard resolves it per
 * request from depot-service and caches it briefly. MANAGER moves here from the locked set
 * in the same change that starts resolving — never earlier, or every existing manager
 * would widen to the whole network for a release.
 */
export const DEPOT_SCOPED_ROLES: ReadonlySet<Role> = new Set([
  Role.ASSISTANT_SUPERVISOR,
  Role.SUPERVISOR,
  Role.MANAGER,
]);

export function isDepotLocked(role: Role): boolean {
  return DEPOT_LOCKED_ROLES.has(role);
}

/** Whether this role sees a resolved SET of depots rather than one or all of them. */
export function isDepotResolved(role: Role): boolean {
  return DEPOT_SCOPED_ROLES.has(role);
}

/** Whether depot scoping applies at all. Everyone else (HQ, finance, system) sees all. */
export function isDepotScoped(role: Role): boolean {
  return isDepotLocked(role) || isDepotResolved(role);
}

/**
 * The depots a caller may touch, or `undefined` for an unscoped caller.
 *
 * `depotIds` is filled in by DepotScopeGuard; the `[depotId]` fallback keeps by-id checks
 * correct on paths that build a user object by hand (tests, internal callers) without
 * passing through the guard.
 */
function allowedDepots(
  user: Pick<AuthenticatedUser, 'role' | 'depotId' | 'depotIds'>,
): readonly string[] | undefined {
  if (!isDepotScoped(user.role)) {
    return undefined;
  }
  if (user.depotIds) {
    return user.depotIds;
  }
  return user.depotId ? [user.depotId] : [];
}

/**
 * Assert a caller may act on a resource that belongs to `resourceDepotId`.
 *
 * Complements DepotScopeGuard: the guard closes the LIST/enumeration vector (depotId in the
 * request), this closes the BY-ID vector — call it in a service/controller after loading a
 * row whose depot isn't in the request URL (e.g. `GET /order-disputes/:id`). Membership in
 * the caller's set, so it covers a locked role (a one-element set) and a supervisor (many)
 * with the same check. No-op for unscoped roles and the system principal.
 *
 * An empty set denies: a supervisor with nothing assigned sees nothing, never everything.
 */
export function assertDepotAccess(
  user: Pick<AuthenticatedUser, 'role' | 'depotId' | 'depotIds'> | undefined,
  resourceDepotId: string | null | undefined,
): void {
  if (!user) {
    return;
  }
  const allowed = allowedDepots(user);
  if (!allowed) {
    return;
  }
  if (!resourceDepotId || !allowed.includes(resourceDepotId)) {
    throw new ForbiddenException(
      'Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya.',
    );
  }
}

/**
 * Assert a FRANCHISE_OWNER only touches a depot they OWN. Stronger than set membership: it
 * compares the row's recorded owner to the caller, so it stays correct even if a resolved
 * set is stale. Call it after loading the depot's `ownerId`.
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
 * Resolve which depots a LIST query must be scoped to. Use on staff list endpoints that
 * carry no mandatory depotId param (e.g. `GET orders/manage`, `GET deliveries`) so a scoped
 * role only ever lists depots it is responsible for — closing the list-without-filter
 * vector DepotScopeGuard can't see (no depotId in the request to compare).
 *
 * - Scoped role: the caller's set, narrowed to `requestedDepotId` when one is given. Throws
 *   if that depot is outside the set, or if the account has no depots at all (fail-closed).
 *   Rows with a null depot never match an `IN` filter, so they stay correctly invisible to
 *   depot staff — HQ-only.
 * - Everyone else: the requested depot if given, else `undefined` (no filter, sees all).
 *
 * Renamed from `depotScopeFilter`, which returned ONE id: keeping that name would have let
 * every list call site silently narrow a supervisor to a single depot. Deleting it makes
 * each one a compile error instead.
 */
export function depotScopeIds(
  user: Pick<AuthenticatedUser, 'role' | 'depotId' | 'depotIds'> | undefined,
  requestedDepotId?: string | null,
): readonly string[] | undefined {
  if (!user) {
    return requestedDepotId ? [requestedDepotId] : undefined;
  }
  const allowed = allowedDepots(user);
  if (!allowed) {
    return requestedDepotId ? [requestedDepotId] : undefined;
  }
  if (allowed.length === 0) {
    throw new ForbiddenException('Akun ini belum diberi tanggung jawab depot manapun.');
  }
  if (requestedDepotId) {
    if (!allowed.includes(requestedDepotId)) {
      throw new ForbiddenException(
        'Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya.',
      );
    }
    return [requestedDepotId];
  }
  return allowed;
}

/** Prisma `where` fragment for a depot filter. `undefined` = no filter (sees all). */
export function depotWhere(depotIds: readonly string[] | undefined): { in: string[] } | undefined {
  return depotIds ? { in: [...depotIds] } : undefined;
}
