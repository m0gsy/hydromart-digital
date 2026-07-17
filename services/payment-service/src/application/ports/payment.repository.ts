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
  search(query: PaymentQuery): Promise<{ items: PaymentRecord[]; total: number }>;
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
  update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord>;
}
