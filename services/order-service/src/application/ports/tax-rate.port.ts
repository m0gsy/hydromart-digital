import { TaxRounding } from '@hydromart/platform';

/** The PPN rate payment-service holds, and the rounding method that resolves a fractional rupiah. */
export interface TaxRate {
  /** Whole or fractional percent, e.g. 11. */
  percent: number;
  rounding: TaxRounding;
}

/**
 * Where an order learns how much of its total is PPN (FR-034).
 *
 * `null` means the rate could not be read AND nothing was cached: a tax outage must never block
 * or reprice a checkout, so the caller records no tax rather than guessing one.
 */
export interface TaxRatePort {
  current(): Promise<TaxRate | null>;
}
