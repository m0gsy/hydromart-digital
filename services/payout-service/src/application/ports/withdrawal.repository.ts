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

/**
 * Settling a withdrawal: it was PAID and written, it was already settled, or there is no
 * such row. Three answers rather than a nullable record, because "already PAID" and "never
 * existed" are a 409 and a 404 and the caller cannot tell them apart from `null`.
 */
export type SettleWithdrawalOutcome<T> =
  | { ok: true; withdrawal: T }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'NOT_PROCESSING'; status: WithdrawalStatus };

export interface WithdrawalRepository {
  /** Next value of the shared reference counter (H-13) — see reference-sequence.ts. */
  nextReferenceSequence(): Promise<number>;
  create(data: CreateWithdrawalData): Promise<WithdrawalRecord>;
  listForOwner(franchiseOwnerId: string, limit: number): Promise<WithdrawalRecord[]>;

  /** Withdrawals still awaiting a bank result, oldest first — the HQ release queue. */
  listProcessing(limit: number): Promise<WithdrawalRecord[]>;

  /**
   * Move a PROCESSING withdrawal to PAID or FAILED.
   *
   * FAILED re-posts the money: the debit went out when the withdrawal was REQUESTED (B-8),
   * so a transfer the bank rejects has to come back or the owner is short by the amount of
   * a payment they never received. The schema has said so since the first migration —
   * "FAILED if the transfer is rejected (a compensating credit re-posts to the ledger)" —
   * and nothing wrote it. The credit rides in the SAME transaction as the status change,
   * and carries a `sourceRef` keyed on the withdrawal so a retried settlement cannot credit
   * twice.
   *
   * The status guard is inside the transaction too: a concurrent second FAILED would
   * otherwise both read PROCESSING and both credit.
   */
  settle(input: {
    id: string;
    status: Extract<WithdrawalStatus, 'PAID' | 'FAILED'>;
    /** Only read for FAILED — the compensating credit. */
    reversal: { sourceRef: string; description: string };
  }): Promise<SettleWithdrawalOutcome<WithdrawalRecord>>;

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
