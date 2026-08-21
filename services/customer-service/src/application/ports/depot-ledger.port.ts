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
/** One movement behind those two numbers, for the CRM detail deposit ledger. */
export interface DepotGallonLedgerEntry {
  id: string;
  type: 'ISSUE' | 'RETURN';
  quantity: number;
  amountIdr: number;
  at: string;
}

/** I5: one depot where THIS customer still holds gallons, or still has deposit. */
export interface CustomerDepotDepositRow {
  depotId: string;
  depotName: string;
  gallonsOnLoan: number;
  depositHeldIdr: number;
}

export interface DepotLedgerPort {
  gallonsByCustomer(depotId: string): Promise<DepotGallonLedgerRow[] | null>;
  /**
   * I5: the mirror of `gallonsByCustomer`. That answers a depot asking about its customers;
   * this answers a customer asking about their depots — the two numbers whose money is
   * theirs, and which they had no screen for anywhere.
   *
   * Fails SOFT to `null` for the same reason as its sibling: `[]` would mean "you are
   * holding nothing and are owed nothing", which is a deposit quietly disappearing.
   */
  depositsForCustomer(customerId: string): Promise<CustomerDepotDepositRow[] | null>;
  /**
   * One customer's deposit movements at this depot.
   *
   * `[]` here — unlike `gallonsByCustomer` — because the screen already tells the truth
   * from the summary above it: an unreachable depot-service leaves the two stat cards
   * saying "belum tersambung", so an empty history reads as "nothing to show yet"
   * rather than as a confirmed zero.
   */
  customerLedger(depotId: string, customerId: string): Promise<DepotGallonLedgerEntry[]>;
}
