/**
 * F8. Who an operational alert about one depot should reach.
 *
 * Every ops event — stock low, stock untracked, meter variance, a HIGH-severity courier
 * incident, the twice-daily sales update — was sent with `customerId: null`, because it is
 * addressed to a phone number rather than to an account. `notify()` skips push when there
 * is no customer id, so none of them had a channel that could wake anybody. The alert
 * landed in the ops feed and waited for somebody to open a screen.
 *
 * The roster lives in auth-service and stays there: crm growing its own depot-to-staff map
 * would be a second copy that drifts the first time somebody changes depots.
 *
 * Implementations FAIL SOFT — unreachable or unconfigured answers `[]`. That is the same
 * position `NotificationPreferencePort` takes and for the same reason: the ops feed row is
 * already written by the time this is asked, so the worst case is a push nobody gets, never
 * an alert nobody has.
 */
export interface DepotStaffPort {
  /** Active staff account ids at this depot. Empty when the roster cannot be read. */
  staffIdsForDepot(depotId: string): Promise<string[]>;
}
