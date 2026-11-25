import { DueMaintenance } from '../application/ports/maintenance-due.port';

/** HD-15: HQ Operasional is the HEAD_OFFICE role (network-wide); the depot's Kepala is KEPALA_DEPOT. */
export const MAINTENANCE_DUE_HQ_ROLES: readonly string[] = ['HEAD_OFFICE'];
export const MAINTENANCE_DUE_DEPOT_ROLE = 'KEPALA_DEPOT';

/** First notice when an item becomes due, then one reminder every this many days while it stays due. */
export const REMINDER_EVERY_DAYS = 3;

const DAY_MS = 86_400_000;
const KEY = /^maintenance-due:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):/;

const num = (n: number): string => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** The dedupe key of one item, one cycle, one WIB day, one recipient. */
export const dueKey = (item: DueMaintenance, date: string, recipientId: string): string =>
  `maintenance-due:${item.id}:${item.cycleStart}:${date}:${recipientId}`;

/** The words for one item: which limit it reached and by how much. */
export function dueReason(item: DueMaintenance): string {
  return item.dueBy === 'VOLUME'
    ? `volume air sudah ${num(item.m3SinceService ?? 0)} m3 dari batas ${num(item.intervalM3 ?? 0)} m3`
    : `sudah ${item.daysSinceService} hari dari batas ${item.intervalDays ?? item.daysSinceService} hari`;
}

/**
 * The items already told about within the reminder window: keys of earlier WIB days (a key of
 * `date` itself is this very run's retry and never blocks it) less than REMINDER_EVERY_DAYS old.
 * Returned as `<itemId>:<cycleStart>`.
 */
export function recentlyTold(keys: readonly string[], date: string): Set<string> {
  const told = new Set<string>();
  for (const key of keys) {
    const m = KEY.exec(key);
    if (!m || m[3] >= date) continue;
    const ageDays = (Date.parse(date) - Date.parse(m[3])) / DAY_MS;
    if (ageDays < REMINDER_EVERY_DAYS) told.add(`${m[1]}:${m[2]}`);
  }
  return told;
}
