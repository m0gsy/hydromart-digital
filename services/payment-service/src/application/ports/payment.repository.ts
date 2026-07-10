import { PaymentMethod, PaymentStatus } from '../../domain/payment';

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
  reference?: string | null;
  instruction?: string | null;
  gatewayData?: string | null;
}

export interface PaymentQuery {
  customerId?: string;
  orderId?: string;
  status?: PaymentStatus;
  page: number;
  limit: number;
}

export interface PaymentRepository {
  create(data: CreatePaymentData): Promise<PaymentRecord>;
  findById(id: string): Promise<PaymentRecord | null>;
  /** Active = PENDING or PAID. Used to enforce one live payment per order. */
  findActiveByOrder(orderId: string): Promise<PaymentRecord | null>;
  findByReference(reference: string): Promise<PaymentRecord | null>;
  search(query: PaymentQuery): Promise<{ items: PaymentRecord[]; total: number }>;
  update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord>;
}
