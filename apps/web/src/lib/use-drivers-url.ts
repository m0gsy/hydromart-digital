'use client';

import { useAuth } from './auth-context';
import { useDepot } from './depot-context';
import { driversUrl } from './drivers-scope';
import { isDepotResolvedRole } from './roles';

/**
 * The roster URL for the signed-in account's current depot view (see `driversUrl`), or `null`
 * while a depot-scoped caller's depot list is still loading — their scope is not known yet, and asking
 * without it is refused. Pair with `whenRosterScoped`.
 */
export function useDriversUrl(): string | null {
  const { selectedId, scopedId, ready } = useDepot();
  const { customer } = useAuth();
  if (isDepotResolvedRole(customer?.role) && !ready) return null;
  return driversUrl({ selectedId, scopedId, role: customer?.role });
}
