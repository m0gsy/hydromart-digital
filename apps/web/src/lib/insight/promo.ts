/**
 * What a promo rule took off, as a share of the value of the orders it took it off.
 *
 * Both figures must come from the same orders, which is why the server returns the discount of
 * the valued sample beside its value rather than the rule's lifetime discount. Null when the
 * value is unknown or zero: there is no honest share to print, and 0% would claim a free promo.
 */
export function discountShare(discount: number, value: number | null): number | null {
  if (value == null || !(value > 0)) return null;
  return discount / value;
}

/** A share as a percentage with one decimal and a comma, e.g. 0.0426 gives "4,3%". */
export function formatShare(share: number): string {
  return `${(Math.round(share * 1000) / 10).toFixed(1).replace('.', ',')}%`;
}
