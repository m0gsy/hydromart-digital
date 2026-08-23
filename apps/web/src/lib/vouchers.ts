/**
 * K1.2 — the wallet (/vouchers) links to checkout with `?voucher=CODE`, because checkout is
 * where a code actually works: it already holds the customer's vouchers and the field.
 *
 * The decision of WHETHER to apply lives here rather than inside the effect that does it:
 * three conditions with one right answer each is exactly the shape that rots silently
 * inside a 1150-line page component, and a pure function is the only version of it that a
 * test can hold. Null means "do nothing" — no cart yet (a quote against no subtotal
 * answers with an error for a voucher that is perfectly good), nothing carried, or it has
 * already been applied once.
 */
export function voucherToApply(
  carried: string | null,
  cartReady: boolean,
  alreadyApplied: boolean,
): string | null {
  if (alreadyApplied || !cartReady) return null;
  const code = carried?.trim().toUpperCase();
  return code ? code : null;
}
