// Depot SOP: bonus target penjualan harian. A ladder of gallon thresholds, each with a
// rupiah reward, evaluated per ATTENDED DAY against the depot's gallons sold that day.
// Pure, no I/O. Empty ladder = feature off, which is what every existing depot has.

export interface GallonBonusTier {
  /** Gallons the depot must sell that day to reach this step. */
  gallons: number;
  /** Rupiah paid to each attending staff member on that day. */
  amount: number;
}

/**
 * Parse a tier CSV ("120:15000,150:20000" = 120 gal→Rp15.000, 150 gal→Rp20.000) into steps
 * sorted ascending by gallons. Malformed / negative entries are dropped; "" → [].
 * Same shape and same defensive parsing as `parseRaiseLadder` in tenure.ts.
 */
export function parseTiers(csv: string): GallonBonusTier[] {
  const tiers: GallonBonusTier[] = [];
  for (const part of csv.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [gStr, aStr] = trimmed.split(':');
    if (gStr === undefined || gStr.trim() === '') continue; // ":15000" — Number('') is 0
    if (aStr === undefined || aStr.trim() === '') continue;
    const g = Number(gStr.trim());
    const a = Number(aStr.trim());
    if (Number.isInteger(g) && g >= 0 && Number.isFinite(a) && a >= 0) {
      tiers.push({ gallons: g, amount: a });
    }
  }
  return tiers.sort((a, b) => a.gallons - b.gallons);
}

/**
 * Bonus for one day: the highest tier whose gallon threshold is met. Below the first
 * threshold, an empty ladder, or an unknown gallon figure (null — order-service down) → 0.
 * null must NEVER pay, exactly like the SALES_TOTAL bonus rule.
 */
export function bonusForDay(tiers: GallonBonusTier[], gallons: number | null): number {
  if (gallons == null) return 0;
  let amount = 0;
  for (const tier of tiers) {
    if (gallons >= tier.gallons) amount = tier.amount;
    else break; // sorted ascending; no later tier can qualify
  }
  return amount;
}
