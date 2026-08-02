/**
 * Depot water-meter reconciliation (kilometer air awal vs akhir).
 *
 * A depot's meter sits on the treated-water side: the difference between the
 * opening and closing reading is the water that actually left the plant that day.
 * The litres the day's recorded sales account for is Σ(quantity × volumeMl); the
 * gap between the two is water that went out without a sale behind it — an
 * unrecorded galon, a leak, or a mistyped reading.
 *
 * Everything here is pure. The service supplies the day's orders and settings;
 * this file decides what the numbers mean.
 */

/** One day's readings for one depot, in cubic metres as read off the dial. */
export interface MeterReading {
  depotId: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  openingM3: number;
  closingM3: number | null;
  /** Raw-water intake meter. Only depots that meter their source fill these. */
  sourceOpeningM3: number | null;
  sourceClosingM3: number | null;
  openedBy: string;
  openedAt: Date;
  closedBy: string | null;
  closedAt: Date | null;
  alertedAt: Date | null;
  note: string | null;
}

/** The sales side of the comparison, summed from one day's order lines. */
export interface SoldTotals {
  /** Litres accounted for by lines that carry a volume. */
  soldLiters: number;
  /** Lines with no `volumeMl` — reported, never silently counted as 0 L. */
  unmeasuredLines: number;
  gallonsDelivered: number;
  revenueIdr: number;
}

export interface MeterReconciliation extends SoldTotals {
  depotId: string;
  date: string;
  reading: MeterReading | null;
  /** Null until the closing reading is entered — the day is not comparable yet. */
  meterLiters: number | null;
  varianceLiters: number | null;
  /** Variance expressed in whole-ish galon, using the depot's reference volume. */
  varianceGallons: number | null;
  /** Null when nothing was delivered: no basis to price a galon that day. */
  varianceIdr: number | null;
  /** RO recovery. Null unless both raw-water readings are present. */
  roYieldPct: number | null;
  referenceVolumeMl: number;
  toleranceLiters: number;
  overTolerance: boolean;
}

export interface MeterHistoryRow {
  /** 'YYYY-MM-DD'. */
  day: string;
  meterLiters: number | null;
  soldLiters: number;
  varianceLiters: number | null;
  varianceGallons: number | null;
  roYieldPct: number | null;
}

const M3_TO_LITERS = 1000;

/** Rounds to 2dp without exposing float noise (0.1+0.2 style) in a reported figure. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Litres between two dial readings in m³, or null when the second is missing. */
export function litersBetween(openingM3: number, closingM3: number | null): number | null {
  return closingM3 === null ? null : round2((closingM3 - openingM3) * M3_TO_LITERS);
}

/**
 * Litres a set of order lines accounts for, plus the count of lines that could not
 * be measured. A line with no `volumeMl` is NOT zero litres — it is unknown, and
 * folding unknown into zero would report a fake surplus of exactly its true volume.
 */
export function sumSoldLiters(lines: { quantity: number; volumeMl: number | null }[]): {
  soldLiters: number;
  unmeasuredLines: number;
} {
  let soldLiters = 0;
  let unmeasuredLines = 0;
  for (const line of lines) {
    if (line.volumeMl === null) {
      unmeasuredLines += 1;
      continue;
    }
    soldLiters += (line.quantity * line.volumeMl) / 1000;
  }
  return { soldLiters: round2(soldLiters), unmeasuredLines };
}

export interface ReconcileInput {
  depotId: string;
  date: string;
  reading: MeterReading | null;
  totals: SoldTotals;
  referenceVolumeMl: number;
  toleranceLiters: number;
}

/**
 * The whole comparison. Positive variance = more water left the plant than the
 * day's sales explain (unrecorded galon / leak); negative = sales claim more water
 * than the meter saw (mis-keyed reading, or a meter that is under-reading).
 */
export function reconcile(input: ReconcileInput): MeterReconciliation {
  const { depotId, date, reading, totals, referenceVolumeMl, toleranceLiters } = input;
  const meterLiters = reading ? litersBetween(reading.openingM3, reading.closingM3) : null;
  const sourceLiters =
    reading && reading.sourceOpeningM3 !== null && reading.sourceClosingM3 !== null
      ? litersBetween(reading.sourceOpeningM3, reading.sourceClosingM3)
      : null;

  const varianceLiters = meterLiters === null ? null : round2(meterLiters - totals.soldLiters);
  const varianceGallons =
    varianceLiters === null ? null : round2(varianceLiters / (referenceVolumeMl / 1000));

  // Price the variance off the day's own revenue per delivered galon. No galon
  // delivered means there is no price to apply — report null, not a confident zero.
  const idrPerGallon =
    totals.gallonsDelivered > 0 ? totals.revenueIdr / totals.gallonsDelivered : null;
  const varianceIdr =
    varianceGallons === null || idrPerGallon === null
      ? null
      : Math.round(varianceGallons * idrPerGallon);

  // Recovery only means something when the intake was metered too, and a zero
  // intake reading pair would divide by zero rather than mean "0% recovery".
  const roYieldPct =
    meterLiters === null || sourceLiters === null || sourceLiters <= 0
      ? null
      : round2((meterLiters / sourceLiters) * 100);

  return {
    depotId,
    date,
    reading,
    meterLiters,
    ...totals,
    varianceLiters,
    varianceGallons,
    varianceIdr,
    roYieldPct,
    referenceVolumeMl,
    toleranceLiters,
    overTolerance: varianceLiters !== null && Math.abs(varianceLiters) > toleranceLiters,
  };
}
