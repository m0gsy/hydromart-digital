/**
 * No-show gate (design 5a). A courier may only fail a delivery as "customer not
 * present" after making enough contact attempts AND waiting long enough — the two
 * together stop a premature no-show that would deny a paying customer their order.
 * Framework-free; the counts/timings come from config (NO_SHOW_MIN_*).
 */

/** How a courier tried to reach the customer before declaring a no-show. */
export enum ContactMethod {
  CALL = 'CALL',
  WHATSAPP = 'WHATSAPP',
}

export interface NoShowPolicy {
  /** Minimum contact attempts before a no-show is allowed. */
  minAttempts: number;
  /** Minimum seconds to wait, measured from the first attempt. */
  minWaitSeconds: number;
}

/** Contact history for one delivery, summarised for the gate. */
export interface ContactState {
  attempts: number;
  firstAttemptAt: Date | null;
}

/** When the no-show becomes allowed (first attempt + wait), or null if none yet. */
export function noShowEligibleAt(state: ContactState, policy: NoShowPolicy): Date | null {
  if (!state.firstAttemptAt) {
    return null;
  }
  return new Date(state.firstAttemptAt.getTime() + policy.minWaitSeconds * 1000);
}

/** Whether a no-show may be declared now: enough attempts AND the wait elapsed. */
export function canMarkNoShow(state: ContactState, policy: NoShowPolicy, now: Date): boolean {
  const eligibleAt = noShowEligibleAt(state, policy);
  return state.attempts >= policy.minAttempts && eligibleAt != null && now >= eligibleAt;
}
