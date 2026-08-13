/**
 * One money representation for the whole platform: IDR as a whole number of rupiah.
 *
 * It exists because `money()` was defined — byte-identically — inside both
 * order-service and payment-service, and the two are the pair that has to agree: the
 * order's `total` is what the payment's `amount` is checked against (SEC-1). Two private
 * copies of a rounding rule is one copy away from two different rounding rules.
 *
 * Storage stays `Decimal(12,2)` / `Decimal(14,2)` in Postgres — this is the arithmetic
 * boundary, not the storage format. Prisma hands back `Decimal`; call `.toNumber()` once
 * at the repository edge and everything above it does money arithmetic through here.
 *
 * WHOLE rupiah, decided 2026-08-13. It used to keep two decimals, which nothing in the
 * business can pay: there is no circulating sub-rupiah coin, no receipt prints one, and no
 * cashier can hand one back. The cost of keeping them was a divergence nobody could see —
 * the web client rounded prices to whole rupiah while the server stored `4.999,95`, so the
 * screen and the stored order disagreed by cents on every percentage discount. One rule,
 * both sides, and the difference is gone by construction rather than by convention.
 */

/**
 * Rounds to whole rupiah so money arithmetic never drifts on a float and never produces an
 * amount that cannot be paid. Half-up via `Math.round`, matching what the web client does.
 */
export function money(value: number): number {
  return Math.round(value);
}
