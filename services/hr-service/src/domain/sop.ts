import { AudienceTarget } from './announcement';

/** The one thing every rule here needs from a version. Days are WIB `YYYY-MM-DD` keys. */
export interface SopVersionShape {
  versionNo: number;
  effectiveFrom: string;
  allDepots: boolean;
  depotIds: readonly string[];
}

/**
 * `effectiveFrom` is a Prisma `@db.Date`, which arrives as a Date at UTC midnight of the
 * calendar day HQ typed. The UTC slice of THAT value is the WIB day; it is not a clock reading.
 */
export function dayKeyOf(date: Date): string {
  // tz-ok: effectiveFrom is @db.Date — the UTC slice IS the local day
  return date.toISOString().slice(0, 10);
}

export function coversDepot(version: SopVersionShape, depotId: string): boolean {
  return version.allDepots || version.depotIds.includes(depotId);
}

/**
 * The version a depot works from on `today`: the highest number that has taken effect and
 * names that depot (or every depot). A later version that does not name the depot never
 * supersedes it — a depot-specific SOP and a company-wide one coexist per version.
 */
export function inForce<T extends SopVersionShape>(
  versions: readonly T[],
  depotId: string,
  today: string,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > today || !coversDepot(v, depotId)) continue;
    if (!best || v.versionNo > best.versionNo) best = v;
  }
  return best;
}

/** The newest version that has taken effect anywhere — what the HQ list calls "berlaku". */
export function currentVersion<T extends SopVersionShape>(
  versions: readonly T[],
  today: string,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > today) continue;
    if (!best || v.versionNo > best.versionNo) best = v;
  }
  return best;
}

/** Who must read a version: everyone, or the people at (or lent from) the named depots. */
export function audienceTargets(version: Pick<SopVersionShape, 'allDepots' | 'depotIds'>): AudienceTarget[] {
  return version.allDepots
    ? [{ dimension: 'COMPANY', value: null }]
    : version.depotIds.map((value) => ({ dimension: 'DEPOT' as const, value }));
}
