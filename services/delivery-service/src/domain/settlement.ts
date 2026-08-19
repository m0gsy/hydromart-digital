/**
 * End-of-shift COD settlement rules (design 2d/9a). Framework-free.
 *
 * A settlement reconciles the cash a courier deposits against the PAID-cash total
 * over the orders they delivered that shift. The expected total is snapshotted at
 * submit time, so a later refund never silently moves the debt the courier settled.
 */

export enum SettlementStatus {
  SUBMITTED = 'SUBMITTED',
  VERIFIED = 'VERIFIED',
  DISPUTED = 'DISPUTED',
}

/** deposited - expected. Negative = shortfall (courier deposited too little). */
export function computeVariance(expectedAmount: number, depositedAmount: number): number {
  return depositedAmount - expectedAmount;
}

/** A shortfall means the courier owes the depot — the only case that can be charged. */
export function isShortfall(variance: number): boolean {
  return variance < 0;
}

/**
 * A surplus this large has to be explained before a cashier can sign it off (C1).
 *
 * A courier cannot create an order — only checkout and the depot counter can — so cash
 * ABOVE the expected total means goods moved without one: stock not deducted, franchise
 * revenue not credited, physical stock permanently adrift from the system. The surplus is
 * the only signal there is that it happened, and taking it silently throws that away.
 *
 * ponytail: a constant, not a per-depot SettingDef — deliberately, to avoid one more
 * number every depot must fill in before go-live. The ceiling: the first depot whose
 * gallon price sits well above this turns it into a setting with 5000 as the default,
 * using the SETTING_DEFS machinery that is already here.
 */
export const SURPLUS_NOTE_THRESHOLD_IDR = 5000;

/**
 * Does this variance need a written explanation before it can be verified?
 *
 * Surplus only. A shortfall is already visible, already chargeable, and blocking it on a
 * note would only delay money the depot is owed.
 */
export function surplusNeedsNote(variance: number): boolean {
  return variance > SURPLUS_NOTE_THRESHOLD_IDR;
}

/** The cashier can only rule on a settlement the courier has just submitted. */
export function canResolve(status: SettlementStatus): boolean {
  return status === SettlementStatus.SUBMITTED;
}
