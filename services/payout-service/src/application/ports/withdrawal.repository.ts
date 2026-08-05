import { WithdrawalRecord, WithdrawalStatus } from '../../domain/ledger';

export interface CreateWithdrawalData {
  franchiseOwnerId: string;
  amount: number;
  bankAccountRef: string;
  reference: string;
  status: WithdrawalStatus;
}

/**
 * Either the withdrawal was written, or the balance was not enough and NOTHING was —
 * the same shape depot-service's reserveAtomic uses, so the caller decides what error to
 * raise and the repository stays free of domain errors.
 */
export type WithdrawalOutcome =
  | { ok: true; withdrawal: WithdrawalRecord }
  | { ok: false; balance: number };

export interface WithdrawalRepository {
  create(data: CreateWithdrawalData): Promise<WithdrawalRecord>;
  listForOwner(franchiseOwnerId: string, limit: number): Promise<WithdrawalRecord[]>;

  /**
   * Take money out: check the balance and write both the withdrawal and its matching
   * ledger debit, atomically and serialized per owner (B-8).
   *
   * Previously the balance was read, checked, and then two independent rows were written
   * with no transaction. Two concurrent requests both read the same balance and both
   * passed, so an owner could withdraw more than they had; and a crash between the two
   * writes left a PROCESSING withdrawal with the balance untouched — money owed twice.
   *
   * The balance is a SUM over ledger rows, so there is no single row to lock. A
   * transaction-scoped advisory lock keyed on the owner is the gate instead: concurrent
   * withdrawals for one owner queue, and each one's check sees every debit committed
   * before it. Different owners never block each other.
   */
  withdrawWithDebit(input: {
    franchiseOwnerId: string;
    amount: number;
    bankAccountRef: string;
    reference: string;
    status: WithdrawalStatus;
    description: string;
  }): Promise<WithdrawalOutcome>;
}
