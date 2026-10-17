// Tax arithmetic (M29-10). Framework-free and pure so the rounding rule can be pinned
// by tests — this is money, and the method is a legal choice, not an implementation
// detail.

/**
 * How a fractional rupiah is resolved when PPN is computed.
 *
 * HALF_UP is the default because PER-11/2025 settles a half-rupiah upward; the others
 * exist because some counterparties reconcile on a different convention and a mismatch
 * of one rupiah per line still fails a reconciliation.
 */
export enum TaxRounding {
  /** 0.5 → 1. Indonesian default (PER-11/2025). */
  HALF_UP = 'HALF_UP',
  /** 0.5 → nearest even ("banker's"); removes the upward bias over many lines. */
  HALF_EVEN = 'HALF_EVEN',
  /** Always toward zero. Some legacy ERPs truncate. */
  DOWN = 'DOWN',
}

export const DEFAULT_TAX_ROUNDING = TaxRounding.HALF_UP;

export function isTaxRounding(value: unknown): value is TaxRounding {
  return (
    value === TaxRounding.HALF_UP || value === TaxRounding.HALF_EVEN || value === TaxRounding.DOWN
  );
}

/**
 * Round to whole rupiah by the chosen method. Negative amounts (refunds, credit notes)
 * are rounded symmetrically about zero, so a refund of a rounded charge cancels it
 * exactly instead of leaving a one-rupiah residue.
 */
export function roundIdr(value: number, method: TaxRounding = DEFAULT_TAX_ROUNDING): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  switch (method) {
    case TaxRounding.DOWN:
      return sign * Math.floor(abs);
    case TaxRounding.HALF_EVEN: {
      const floor = Math.floor(abs);
      const rest = abs - floor;
      if (rest > 0.5) return sign * (floor + 1);
      if (rest < 0.5) return sign * floor;
      return sign * (floor % 2 === 0 ? floor : floor + 1);
    }
    default:
      // Math.round() breaks ties upward, which is HALF_UP once the sign is factored out.
      return sign * Math.round(abs);
  }
}

/**
 * PPN on a base amount, in whole rupiah.
 *
 * `priceIncludesTax` decides which direction the arithmetic runs: when the displayed
 * price already contains the tax, the tax is the portion carved OUT of it
 * (base × p / (100 + p)); otherwise it is added ON TOP (base × p / 100). Getting this
 * backwards is the classic invoice bug, so both directions are covered by tests.
 */
export function computePpn(
  base: number,
  ppnPercent: number,
  priceIncludesTax: boolean,
  method: TaxRounding = DEFAULT_TAX_ROUNDING,
): number {
  if (!(ppnPercent > 0)) return 0;
  const raw = priceIncludesTax
    ? (base * ppnPercent) / (100 + ppnPercent)
    : (base * ppnPercent) / 100;
  return roundIdr(raw, method);
}
