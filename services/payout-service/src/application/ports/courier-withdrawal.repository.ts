import { WithdrawalStatus } from '../../domain/ledger';

export interface CourierWithdrawalRecord {
  id: string;
  courierId: string;
  amount: number;
  bankAccountRef: string;
  status: WithdrawalStatus;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCourierWithdrawalData {
  courierId: string;
  amount: number;
  bankAccountRef: string;
  reference: string;
  status: WithdrawalStatus;
}

/** Written, or refused with the balance that refused it — nothing in between. */
export type CourierWithdrawalOutcome =
  | { ok: true; withdrawal: CourierWithdrawalRecord }
  | { ok: false; balance: number };

export interface CourierWithdrawalRepository {
  create(data: CreateCourierWithdrawalData): Promise<CourierWithdrawalRecord>;
  listForCourier(courierId: string, limit: number): Promise<CourierWithdrawalRecord[]>;

  /**
   * The courier twin of WithdrawalRepository.withdrawWithDebit (B-8, B-10).
   *
   * Same two defects as the franchise-owner path: the balance was read and checked on one
   * connection and the withdrawal row and its debit were written as two independent
   * statements, so an overdraft was reachable by sending two requests at once and a crash
   * between the writes left a PROCESSING payout with the balance untouched.
   *
   * The debit also carries a sourceRef now. It was the only one of the four courier ledger
   * writes without one (B-10), which meant it alone had no idempotency key — a retried
   * withdrawal could debit twice.
   */
  withdrawWithDebit(input: {
    courierId: string;
    amount: number;
    bankAccountRef: string;
    reference: string;
    status: WithdrawalStatus;
    description: string;
  }): Promise<CourierWithdrawalOutcome>;
}
