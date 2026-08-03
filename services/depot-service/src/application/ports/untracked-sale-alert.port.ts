/**
 * Warns the depot when an order sold a product the depot has no stock line for.
 *
 * The sale is NOT blocked (a customer's order must not fail because paperwork is
 * missing), but it leaves no trace in the stock ledger: nothing is deducted, the line
 * never runs low, and the shelf empties silently. So the sale goes through and the
 * operator is told — the one thing we must never do is both allow it and stay quiet.
 *
 * Best-effort, exactly like LowStockAlertPort: implementations never throw, because a
 * failed warning must not roll back a customer's order.
 */
export interface UntrackedSaleAlert {
  depotId: string;
  depotName: string;
  orderId: string;
  /** Catalog ids sold with no stock line behind them. Never empty. */
  productIds: string[];
}

export interface UntrackedSaleAlertPort {
  emit(alert: UntrackedSaleAlert, authorization: string): Promise<void>;
}
