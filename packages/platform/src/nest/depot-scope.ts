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
