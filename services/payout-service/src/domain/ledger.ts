export type LedgerEntryType =
  'SALE_SETTLEMENT' | 'COMMISSION' | 'STOCK_PURCHASE' | 'WITHDRAWAL' | 'ADJUSTMENT';

export type WithdrawalStatus = 'PROCESSING' | 'PAID' | 'FAILED';

export interface LedgerEntryRecord {
  id: string;
  franchiseOwnerId: string;
  depotId: string | null;
  type: LedgerEntryType;
  /** Signed IDR: positive = credit, negative = debit. */
  amount: number;
  description: string;
  occurredAt: Date;
  createdAt: Date;
}

/** A ledger entry together with the idempotency key it was pushed under. */
export interface LedgerEntryWithRef extends LedgerEntryRecord {
  sourceRef: string;
}

export interface WithdrawalRecord {
  id: string;
  franchiseOwnerId: string;
  amount: number;
  bankAccountRef: string;
  status: WithdrawalStatus;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
}
