export interface PriceOverrideAlert {
  depotId: string;
  depotName: string;
  /** How many proposals this alert stands for: one, or a whole CSV import. */
  count: number;
  /** The product of the (first) proposal, for the copy. */
  product: string;
}

/**
 * Flow 6b (plan PR-6): a depot proposed price changes; crm wakes the accounts that may decide
 * them (`priceOverrideDecide`). Best-effort: never throws, the proposals are already stored.
 */
export interface PriceOverrideAlertPort {
  emit(alert: PriceOverrideAlert): Promise<void>;
}
