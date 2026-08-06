/**
 * One money representation for the whole platform: IDR as a JavaScript number carrying
 * at most two decimal places.
 *
 * It exists because `money()` was defined — byte-identically — inside both
 * order-service and payment-service, and the two are the pair that has to agree: the
 * order's `total` is what the payment's `amount` is checked against (SEC-1). Two private
 * copies of a rounding rule is one copy away from two different rounding rules.
 *
 * Storage stays `Decimal(12,2)` / `Decimal(14,2)` in Postgres — this is the arithmetic
 * boundary, not the storage format. Prisma hands back `Decimal`; call `.toNumber()` once
 * at the repository edge and everything above it does money arithmetic through here.
 */

/** Rounds to 2 decimals (IDR minor units) so money arithmetic never drifts on a float. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}
