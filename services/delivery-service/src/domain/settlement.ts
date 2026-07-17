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

/** The cashier can only rule on a settlement the courier has just submitted. */
export function canResolve(status: SettlementStatus): boolean {
  return status === SettlementStatus.SUBMITTED;
}
