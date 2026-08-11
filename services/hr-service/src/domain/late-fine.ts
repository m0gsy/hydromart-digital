// Depot SOP: denda telat bertingkat. The SOP fines lateness in three steps rather than at
// one flat rate, and the steps differ by jabatan (kepala depot pays more than staf).
// Pure, no I/O. An empty CSV means the depot keeps the old flat `lateDeductionAmount`.

/** The three SOP steps, in rupiah. */
export interface LateFines {
  /** Late, but before the tier-2 boundary. */
  tier1: number;
  /** Past the tier-2 boundary. */
  tier2: number;
  /** So late the SOP counts the day as not attended at all. */
  absent: number;
}

export type LateTier = 'NONE' | 'T1' | 'T2' | 'ABSENT';

/**
 * Parse the three-number CSV the SOP table is shaped like ("10000,15000,20000" =
 * telat 1, telat 2, tidak absen). Returns null for an empty or malformed value — the
 * caller reads null as "this depot has no tiered fine", NOT as "three zero fines",
 * because those two mean opposite things for the old flat deduction.
 */
export function parseFines(csv: string): LateFines | null {
  const parts = csv.split(',').map((p) => p.trim());
  if (parts.length !== 3) return null;
  const [tier1, tier2, absent] = parts.map(Number);
  if (parts.some((p) => p === '')) return null; // Number('') is 0 — never a real fine
  if (![tier1, tier2, absent].every((n) => Number.isFinite(n) && n >= 0)) return null;
  return { tier1, tier2, absent };
}

/**
 * Which step a day's lateness falls in.
 *
 * `lateMinutes` is measured from the shift START, not from the end of the tolerance
 * window (see attendance.service) — so for the SOP's 07:50 start, "past 09:00" is 70 and
 * "past 10:00" is 130. It is already 0 for anyone who arrived within tolerance.
 *
 * A boundary of 0 is "not configured", which switches that step off rather than making
 * every late minute cross it: a depot that sets only the fines gets one tier, not three.
 */
export function tierOf(lateMinutes: number, tier2After: number, absentAfter: number): LateTier {
  if (lateMinutes <= 0) return 'NONE';
  if (absentAfter > 0 && lateMinutes >= absentAfter) return 'ABSENT';
  if (tier2After > 0 && lateMinutes >= tier2After) return 'T2';
  return 'T1';
}
