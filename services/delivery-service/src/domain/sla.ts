/**
 * HD-6 #19/#20: the one place that decides "on time".
 *
 * The clock starts when the courier of the attempt that SUCCEEDED was assigned. A customer
 * reschedule restarts it (the repository stamps `slaStartedAt` when the row is re-opened);
 * a depot swapping the courier never touches it. Rows with no `slaStartedAt` are still on
 * their first attempt, so `assignedAt` is the start.
 */
export function slaClockStart(d: { assignedAt: Date; slaStartedAt: Date | null }): Date {
  return d.slaStartedAt ?? d.assignedAt;
}

/**
 * Who asked for a reschedule. Only a CUSTOMER request restarts the SLA clock when the row is
 * re-opened; a courier-side problem (COURIER) or a depot taking the delivery off a courier (to
 * swap them) keeps the old start.
 */
export type RescheduleInitiator = 'CUSTOMER' | 'COURIER' | 'DEPOT';

/** What the courier app says on a reschedule: the customer asked, or the courier could not. */
export const RESCHEDULE_REASONS = ['CUSTOMER_REQUEST', 'COURIER_ISSUE'] as const;
export type RescheduleReason = (typeof RESCHEDULE_REASONS)[number];

/** An absent reason is an old app: "the new time agreed with the customer". */
export function initiatorOf(reason: RescheduleReason | undefined): RescheduleInitiator {
  return reason === 'COURIER_ISSUE' ? 'COURIER' : 'CUSTOMER';
}

export function isOnTime(start: Date, deliveredAt: Date, thresholdMinutes: number): boolean {
  return (deliveredAt.getTime() - start.getTime()) / 60_000 <= thresholdMinutes;
}

/**
 * Reader rule for a delivered row: the STORED verdict when there is one, else today's
 * computation (assignedAt clock) with the threshold the caller has. FORWARD-ONLY: rows
 * completed before the verdict was stored (null) are graded exactly as they always were, so
 * no figure already shown, approved or paid moves.
 */
export function onTimeOf(
  d: { assignedAt: Date; deliveredAt: Date; slaOnTime: boolean | null },
  fallbackThresholdMinutes: number,
): boolean {
  return d.slaOnTime ?? isOnTime(d.assignedAt, d.deliveredAt, fallbackThresholdMinutes);
}
