/**
 * Activity conditions an audience can be cut by. These live in order-service (they are
 * facts about orders), which is why they are NOT part of `SegmentFilter`'s tier/city —
 * those are customer attributes and are resolved from the customer directory.
 */
export interface ActivityConditions {
  /** Last order within this many days (still active). */
  recencyDays?: number;
  /** Last order OLDER than this many days (lapsed / at-risk). */
  lapsedDays?: number;
  /** First order within this many days (newly acquired). */
  newWithinDays?: number;
  /** At least this many non-cancelled orders. */
  minOrders?: number;
  /** Has ordered at this depot; also scopes the other conditions to that depot. */
  depotId?: string;
}

/** True when the filter asks order-service anything at all. */
export function hasActivityConditions(c: ActivityConditions): boolean {
  return (
    c.recencyDays != null ||
    c.lapsedDays != null ||
    c.newWithinDays != null ||
    c.minOrders != null ||
    c.depotId != null
  );
}

/**
 * Resolves WHO is in an activity segment, from order-service.
 *
 * Implementations THROW rather than return a short list — an audience that quietly comes
 * back partial is a campaign that reports "sent" after reaching some of the people the
 * screen promised, which is indistinguishable from success.
 */
export interface ActivitySegmentPort {
  customersIn(conditions: ActivityConditions): Promise<string[]>;
}
