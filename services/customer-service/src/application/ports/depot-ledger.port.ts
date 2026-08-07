/** One customer's empties still out, and deposit still held, at one depot. */
export interface DepotGallonLedgerRow {
  customerId: string;
  gallonsOnLoan: number;
  depositHeldIdr: number;
}

/**
 * The depot's gallon ledger, per customer (J-2).
 *
 * The directory's `gallonsOnLoan` / `depositHeldIdr` columns were hardcoded `null` because
 * customer-service had no depot-service port at all. A blank cell reads as "zero gallons on
 * loan", and that is a deposit quietly disappearing — so until this answers, the screen
 * says "belum tersambung" rather than a number nobody checked.
 *
 * Fails SOFT, like the order-CRM port beside it: `null` means "not known", which the screen
 * renders honestly. It must never be `[]`, which would mean "nobody owes anything".
 */
export interface DepotLedgerPort {
  gallonsByCustomer(depotId: string): Promise<DepotGallonLedgerRow[] | null>;
}
