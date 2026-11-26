import { DueMaintenance } from '../application/ports/maintenance-due.port';

/** HD-15: HQ Operasional is the HEAD_OFFICE role (network-wide); the depot's Kepala is KEPALA_DEPOT. */
export const MAINTENANCE_DUE_HQ_ROLES: readonly string[] = ['HEAD_OFFICE'];
export const MAINTENANCE_DUE_DEPOT_ROLE = 'KEPALA_DEPOT';

/** First notice when an item is found due, then one reminder every this many days while it stays due. */
export const REMINDER_EVERY_DAYS = 3;
/** Items named in one depot digest's row (the rest is counted), and items remembered per digest key. */
const LISTED_ITEMS = 5;
export const ITEMS_PER_DIGEST = 30;
const LISTED_DEPOTS = 6;

const DAY_MS = 86_400_000;
/** The dedupe-key family of the maintenance sweep; HD-14's permit and lab-test sweeps reuse every helper below with their own. */
export const MAINTENANCE_KEY_PREFIX = 'maintenance-due';
const keyPattern = (prefix: string): RegExp =>
  new RegExp(`^${prefix}:([0-9a-f-]{36}|hq):(\\d{4}-\\d{2}-\\d{2}):([^:]+):(.*)$`);

/** What a key remembers of an item: its id's head and the day its due cycle began. */
export interface Tagged {
  id: string;
  cycleStart: string;
}

const num = (n: number): string => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** What identifies one item in one due cycle inside a key: its id's head and the day the cycle began. */
export const tagOf = (item: Tagged): string =>
  `${item.id.slice(0, 8)}${item.cycleStart.replace(/-/g, '')}`;

/**
 * The dedupe key of one depot digest: the depot, the WIB day, the recipient and the items it
 * lists (at most ITEMS_PER_DIGEST). The key IS the memory of who was told what, so a later run
 * decides per (item, recipient) without a table of its own.
 */
export const depotKey = (
  depotId: string,
  date: string,
  recipientId: string,
  items: readonly Tagged[],
  prefix = MAINTENANCE_KEY_PREFIX,
): string => `${prefix}:${depotId}:${date}:${recipientId}:${items.map(tagOf).join('.')}`;

/** HQ's digest names no more than this many items in its key (the lowest ids), see `hqTracked`. */
export const HQ_TRACKED = 100;

/**
 * The items whose being new decides whether HQ is told again before the 3-day reminder. Capped so
 * the key stays inside a unique index entry: an item past the cap is covered by the reminder only.
 */
export const hqTracked = <T extends Tagged>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => tagOf(a).localeCompare(tagOf(b))).slice(0, HQ_TRACKED);

/** One HQ digest per run per HQ account; its key records the items it was tracking, as a depot's does. */
export const hqKey = (date: string, recipientId: string, items: readonly Tagged[], prefix = MAINTENANCE_KEY_PREFIX): string =>
  `${prefix}:hq:${date}:${recipientId}:${hqTracked(items).map(tagOf).join('.') || '-'}`;

/**
 * Who was told what in the last REMINDER_EVERY_DAYS days (today included, so a retry of this very
 * run finds its own earlier rows): `<scope>|<recipient>` to the item tags in their digests.
 */
export function toldBy(
  keys: readonly string[],
  date: string,
  prefix = MAINTENANCE_KEY_PREFIX,
): Map<string, Set<string>> {
  const key = keyPattern(prefix);
  const told = new Map<string, Set<string>>();
  for (const k of keys) {
    const m = key.exec(k);
    if (!m) continue;
    const ageDays = (Date.parse(date) - Date.parse(m[2])) / DAY_MS;
    if (ageDays < 0 || ageDays >= REMINDER_EVERY_DAYS) continue;
    const at = `${m[1]}|${m[3]}`;
    const tags = told.get(at) ?? new Set<string>();
    for (const tag of m[4].split('.')) tags.add(tag);
    told.set(at, tags);
  }
  return told;
}

/** The words for one item: which limit it reached and by how much. */
export function dueReason(item: DueMaintenance): string {
  return item.dueBy === 'VOLUME'
    ? `volume air sudah ${num(item.m3SinceService ?? 0)} m3 dari batas ${num(item.intervalM3 ?? 0)} m3`
    : `sudah ${item.daysSinceService} hari dari batas ${item.intervalDays ?? item.daysSinceService} hari`;
}

/** One depot's digest: its name, and its due items with the reason each is due. */
export function depotDigest(items: readonly DueMaintenance[]): { depot: string; items: string; depotId: string } {
  const listed = items.slice(0, LISTED_ITEMS).map((i) => `${i.name} (${dueReason(i)})`);
  const rest = items.length - listed.length;
  return {
    depot: items[0].depotName,
    // The digest names up to LISTED_ITEMS; the tap opens the depot's maintenance list for the rest.
    depotId: items[0].depotId,
    items: rest > 0 ? `${listed.join('; ')}; dan ${rest} lainnya` : listed.join('; '),
  };
}

/** HQ's digest: how many depots, and the due count of the busiest ones. */
export function hqDigest(items: ReadonlyArray<Pick<DueMaintenance, 'depotName'>>): { depot: string; items: string } {
  const per = new Map<string, number>();
  for (const i of items) per.set(i.depotName, (per.get(i.depotName) ?? 0) + 1);
  const ranked = [...per].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const listed = ranked.slice(0, LISTED_DEPOTS).map(([name, n]) => `${name} ${n}`);
  const rest = ranked.length - listed.length;
  return {
    depot: `${ranked.length} depot`,
    items: `${items.length} item: ${listed.join(', ')}${rest > 0 ? `, dan ${rest} depot lainnya` : ''}`,
  };
}
