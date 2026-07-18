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
  intervalDays: number;
  lastServicedAt: Date | null;
  nextDueAt: Date;
  status: MaintenanceStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const NEW_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the health status from the next-due date. DUE if overdue; SOON if due within
 * `soonDays`; NEW if freshly serviced (within the last 14 days) and not yet due; else HEALTHY.
 */
export function deriveMaintenanceStatus(
  nextDueAt: Date,
  lastServicedAt: Date | null,
  now: Date,
  soonDays = 14,
): MaintenanceStatus {
  if (nextDueAt.getTime() <= now.getTime()) return MaintenanceStatus.DUE;
  if (nextDueAt.getTime() - now.getTime() <= soonDays * DAY_MS) return MaintenanceStatus.SOON;
  if (lastServicedAt && now.getTime() - lastServicedAt.getTime() <= NEW_WINDOW_DAYS * DAY_MS) {
    return MaintenanceStatus.NEW;
  }
  return MaintenanceStatus.HEALTHY;
}
