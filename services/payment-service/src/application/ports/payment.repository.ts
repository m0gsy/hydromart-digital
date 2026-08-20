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
  /** C2: the drawer this counter payment landed in. Null for delivery and for history. */
  cashierShiftId: string | null;
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
  /** C2: the drawer this counter payment landed in. Null for delivery and for history. */
  cashierShiftId?: string | null;
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

/** PAID cash on one order (whole IDR), for callers that need the per-order split. */
export interface OrderCashRow {
  orderId: string;
  amountIdr: number;
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
  /**
   * Every payment recorded against these orders, newest first.
   *
   * Depot reconciliation reads it. The depot cannot come from the payment row: `depotId` is
   * set only for a counter sale (see the field note above), so filtering payments by depot
   * would answer with the till and call it the depot. The caller passes the ids of orders it
   * already read under its own depot scope instead, and this answers for exactly those.
   */
  findByOrderIds(orderIds: string[]): Promise<PaymentRecord[]>;
/**
 * Customers with repeated refunds in a window — the one fraud signal this platform can
 * already answer without interpretation. A refund is a settled fact with a timestamp and an
 * owner; nothing has to be guessed about intent to count them.
 */
  refundCountsByCustomer(
    from: Date,
    to: Date,
    minRefunds: number,
  ): Promise<{ customerId: string; refunds: number; amountIdr: number }[]>;
  /** Cross-depot HQ queue: payments with a PENDING refund approval, newest first. */
  listPendingRefunds(query: { page: number; limit: number }): Promise<{
    items: PaymentRecord[];
    total: number;
  }>;
  /** Network-wide unsettled (PENDING) payments grouped by method over a date range. */
  aggregateUnsettledByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]>;
  /** Network-wide collected (PAID) revenue grouped by method over a date range. */
  aggregateRevenueByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]>;
  /**
   * PAID cash over the given orders — the courier's COD deposit due — kept per order.
   *
   * Per order and not summed because both callers need the split: order-service's daily
   * report groups it by courier (and the courier is on the ORDER, not on the payment, so
   * the grouping cannot happen here), and delivery-service compares each order's PAID
   * cash against the COD on its delivery row (C1). Orders with no PAID cash payment are
   * simply absent rather than returned as zero rows.
   */
  cashByOrder(orderIds: string[]): Promise<OrderCashRow[]>;
  /**
   * Sum of PAID cash a depot took over a window, by `paidAt` — what should be in that
   * drawer. Bounded by settlement time, not creation: a sale rung up before the shift and
   * settled during it is cash this cashier is holding.
   */
  /**
   * C2: a depot's PAID cash. Given a shift id, it answers for THAT drawer — its own
   * payments, plus any that predate the column and fall in the window. Given none, it is
   * the whole depot over the window, which is what the daily report wants.
   */
  sumDepotCash(
    depotId: string,
    range: DateRange,
    cashierShiftId?: string,
  ): Promise<CashCollectedSummary>;
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
