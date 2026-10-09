'use client';

// An employee lent to another depot changes depot on the server within a quarter hour of
// midnight: the login's depot moves, and so does what every depot-scoped screen should ask
// for. The browser only learns it when something tells it. This is the one place that turns
// "the server says you are at depot X now" into "this client scopes to depot X".

import { getSession } from './session-store';
import { getDepot, setDepot } from './depot-store';

/**
 * Point the stored depot selection at the account's one depot, when it has exactly one.
 *
 * Accounts that sit above a single depot (supervisors, head office) carry no assigned depot
 * and keep whatever they picked - nothing here touches them. Returns whether the selection
 * moved, so a caller knows to reload anything that was fetched under the old scope.
 */
export function reconcileDepot(me: { assignedDepotId?: string | null }): boolean {
  const assigned = me.assignedDepotId ?? null;
  if (!assigned || getDepot() === assigned) return false;
  setDepot(assigned);
  return true;
}

/**
 * True when a job queued for `jobDepotId` can no longer be sent by this account: it was
 * captured at one depot and the signed-in person now belongs to another. Sending it anyway
 * would be answered 403 (the token no longer reaches that depot) - or worse, file the
 * action against the wrong depot's books.
 *
 * Unknown on either side is "not stale": a job is only held back on positive evidence.
 */
export function queuedDepotIsStale(jobDepotId: string | null | undefined): boolean {
  const assigned = getSession()?.customer?.assignedDepotId ?? null;
  return !!jobDepotId && !!assigned && assigned !== jobDepotId;
}
