/**
 * Who works at a depot, from auth-service (which owns the staff accounts). Ids only: an
 * assignee is picked from the roster, never from a name or phone typed by the caller.
 *
 * Fails HARD: a roster that did not answer is an outage, not "this depot has no staff".
 */
export interface StaffRosterPort {
  staffIdsForDepot(depotId: string): Promise<string[]>;
}
