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
/**
 * K2.6: WHEN the untracked sale was noticed.
 *
 * `COMPLETION` was the only moment this alert ever fired, and by then the goods have left
 * the depot — the operator is told about a shelf that emptied hours ago and there is
 * nothing left to decide. `reserveForOrder` knew the same fact at checkout, silently
 * pushed those products onto `skipped`, and promised the sale anyway.
 *
 * Both are worth sending, and they are not the same message: one is "you are about to sell
 * something you do not track", the other is "you just did".
 */
export type UntrackedSaleStage = 'CHECKOUT' | 'COMPLETION';

export interface UntrackedSaleAlert {
  depotId: string;
  depotName: string;
  orderId: string;
  /** Catalog ids sold with no stock line behind them. Never empty. */
  productIds: string[];
  stage: UntrackedSaleStage;
}

export interface UntrackedSaleAlertPort {
  emit(alert: UntrackedSaleAlert, authorization: string): Promise<void>;
}
