import { PaymentMethod, PaymentStatus, RefundApproval } from '../../domain/payment';

export interface PaymentRecord {
  id: string;
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  reference: string | null;
  instruction: string | null;
  gatewayData: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
  refundedAmount: number | null;
  refundApproval: RefundApproval;
  cashReceived: number | null;
  changeGiven: number | null;
  /** Depot whose drawer took the money; set only for a counter sale. */
  depotId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentData {
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  instruction: string | null;
  gatewayData: string | null;
  depotId?: string | null;
}

export interface PaymentStatusPatch {
  status: PaymentStatus;
  paidAt?: Date | null;
  failedAt?: Date | null;
  refundedAt?: Date | null;
  refundReason?: string | null;
  refundedAmount?: number | null;
  refundApproval?: RefundApproval;
  reference?: string | null;
  instruction?: string | null;
  gatewayData?: string | null;
  cashReceived?: number | null;
  changeGiven?: number | null;
}

export interface PaymentQuery {
  customerId?: string;
  orderId?: string;
  status?: PaymentStatus;
  page: number;
  limit: number;
  /** Opaque keyset cursor from the previous page's `nextCursor` (audit Q-16). */
  cursor?: string;
}

/** One method's unsettled (PENDING) total + transaction count, network-wide. */
export interface UnsettledMethodAggregate {
  method: PaymentMethod;
  amount: number;
  count: number;
}

/** COD cash a courier owes: PAID cash payments summed over a set of orders. */
export interface CashCollectedSummary {
  total: number;
  count: number;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface PaymentRepository {
  create(data: CreatePaymentData): Promise<PaymentRecord>;
  findById(id: string): Promise<PaymentRecord | null>;
  /** Active = PENDING or PAID. Used to enforce one live payment per order. */
  findActiveByOrder(orderId: string): Promise<PaymentRecord | null>;
  findByReference(reference: string): Promise<PaymentRecord | null>;
  search(
    query: PaymentQuery,
  ): Promise<{ items: PaymentRecord[]; total: number; nextCursor: string | null }>;
  /** Cross-depot HQ queue: payments with a PENDING refund approval, newest first. */
  listPendingRefunds(query: { page: number; limit: number }): Promise<{
    items: PaymentRecord[];
    total: number;
  }>;
  /** Network-wide unsettled (PENDING) payments grouped by method over a date range. */
  aggregateUnsettledByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]>;
  /** Network-wide collected (PAID) revenue grouped by method over a date range. */
  aggregateRevenueByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]>;
  /** Sum of PAID cash payments over the given orders — the courier's COD deposit due. */
  sumCashCollected(orderIds: string[]): Promise<CashCollectedSummary>;
  /**
   * Sum of PAID cash a depot took over a window, by `paidAt` — what should be in that
   * drawer. Bounded by settlement time, not creation: a sale rung up before the shift and
   * settled during it is cash this cashier is holding.
   */
  sumDepotCash(depotId: string, range: DateRange): Promise<CashCollectedSummary>;
  update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord>;

  /**
   * Compare-and-set on status: apply `patch` only if the row is still in one of
   * `expected`. Returns null when it was not — someone else moved it first.
   *
   * B-9: refund read the payment, checked isRefundable, called the gateway and THEN
   * updated on `id` alone. Two concurrent refunds both read PAID, both passed the check,
   * and both reached the gateway — the customer was paid back twice. A status predicate on
   * the write is what makes exactly one caller win, and it has to be claimed BEFORE the
   * gateway call, not after.
   */
  updateIfStatus(
    id: string,
    expected: PaymentStatus[],
    patch: PaymentStatusPatch,
  ): Promise<PaymentRecord | null>;
}
