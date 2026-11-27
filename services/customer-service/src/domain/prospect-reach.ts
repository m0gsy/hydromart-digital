import { can } from '@hydromart/access';
import { AuthenticatedUser, depotScopeIds } from '@hydromart/platform';

export interface Reach {
  /** `undefined` = a network role, no depot filter. */
  depotIds: readonly string[] | undefined;
  /** Only prospects assigned to the caller: a role that works prospects but does not manage them. */
  assignedOnly: boolean;
}

type ReachUser = Pick<AuthenticatedUser, 'role' | 'depotId' | 'depotIds' | 'sub'>;

/**
 * The one reach rule for a single prospect (and for /mine). `depotScopeIds` throws 403 for a
 * scoped role with no depot. `assignedOnly` is true for a Sales Depot (Work without Manage).
 */
export function reachOf(user: ReachUser, depotIds = depotScopeIds(user)): Reach {
  return { depotIds, assignedOnly: !can('b2bProspectManage', user.role, depotIds) };
}

/**
 * Whether a row is inside the reach. A row with no owner depot (the opportunity map) is reachable
 * by nobody here: it is shown only by the Read/Import routes, never worked, assigned or listed in /mine.
 */
export function inReach(
  reach: Reach,
  user: Pick<AuthenticatedUser, 'sub'>,
  row: { ownerDepotId: string | null; assignedToId: string | null },
): boolean {
  if (row.ownerDepotId === null) return false;
  if (reach.depotIds && !reach.depotIds.includes(row.ownerDepotId)) return false;
  return !reach.assignedOnly || row.assignedToId === user.sub;
}
