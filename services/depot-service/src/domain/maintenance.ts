// Depot equipment/vehicle maintenance schedule. Status is DERIVED from the next-due
// date at read time, never stored authoritatively. Mirrors the Prisma enum; the domain
// never imports the generated client.

export enum MaintenanceStatus {
  DUE = 'DUE',
  SOON = 'SOON',
  HEALTHY = 'HEALTHY',
  NEW = 'NEW',
}

/** A depot-scoped maintenance item with a service interval and a derived health status. */
export interface MaintenanceItem {
  id: string;
  depotId: string;
  name: string;
  category: string;
  /** HD-15: days between services; null for a volume-only item. At least one of the two limits is set. */
  intervalDays: number | null;
  /** HD-15: cubic metres through the depot's meter between services; null for a days-only item. */
  intervalM3: number | null;
  lastServicedAt: Date | null;
  /** Null exactly when `intervalDays` is: a volume-only item has no date it falls due. */
  nextDueAt: Date | null;
  status: MaintenanceStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What made an item due: the day limit or the volume limit, whichever came first. */
export type MaintenanceDueBy = 'DAYS' | 'VOLUME';

/** An item with what the meter and the calendar say about it right now (HD-15). */
export interface MaintenanceItemView extends MaintenanceItem {
  /** Whole days since the last service (or since the item was added when never serviced). */
  daysSinceService: number;
  /** Water through the meter on the complete days since the service; null when unknown or there is no volume limit. */
  m3SinceService: number | null;
  /** Complete days since the service with no closed meter reading; null when there is no volume figure. */
  meterDaysMissing: number | null;
  dueBy: MaintenanceDueBy | null;
}

/** The volume a depot's meter showed between two WIB days, as order-service counts it. */
export interface MeterVolume {
  m3: number;
  /** Days in the range that had a closed reading. */
  readingDays: number;
  /** Days in the range. */
  spanDays: number;
}

const NEW_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the health status from the next-due date. DUE if overdue; SOON if due within
 * `soonDays`; NEW if freshly serviced (within the last 14 days) and not yet due; else HEALTHY.
 */
export function deriveMaintenanceStatus(
  nextDueAt: Date | null,
  lastServicedAt: Date | null,
  now: Date,
  soonDays = 14,
  volumeDue = false,
): MaintenanceStatus {
  if (volumeDue) return MaintenanceStatus.DUE;
  if (nextDueAt && nextDueAt.getTime() <= now.getTime()) return MaintenanceStatus.DUE;
  if (nextDueAt && nextDueAt.getTime() - now.getTime() <= soonDays * DAY_MS) {
    return MaintenanceStatus.SOON;
  }
  if (lastServicedAt && now.getTime() - lastServicedAt.getTime() <= NEW_WINDOW_DAYS * DAY_MS) {
    return MaintenanceStatus.NEW;
  }
  return MaintenanceStatus.HEALTHY;
}

/**
 * Which limit made the item due, or null when it is not due. The day limit is `nextDueAt` (the
 * date a person may have set by hand); the volume limit needs a meter figure, and with none
 * (`m3` null) it can never say "due" - it says nothing rather than guess. When both are past,
 * the one overshot by the larger share of its limit is named.
 */
export function dueByOf(
  item: Pick<MaintenanceItem, 'intervalDays' | 'intervalM3' | 'nextDueAt'>,
  daysSince: number,
  m3: number | null,
  now: Date,
): MaintenanceDueBy | null {
  const daysDue = item.nextDueAt !== null && item.nextDueAt.getTime() <= now.getTime();
  const volumeDue = item.intervalM3 !== null && m3 !== null && m3 >= item.intervalM3;
  if (daysDue && volumeDue) {
    const dayShare = item.intervalDays ? daysSince / item.intervalDays : 0;
    return m3! / item.intervalM3! > dayShare ? 'VOLUME' : 'DAYS';
  }
  return volumeDue ? 'VOLUME' : daysDue ? 'DAYS' : null;
}
