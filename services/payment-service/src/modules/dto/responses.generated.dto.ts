// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `PaymentRecord` exactly — generated for audit D-6, no field added or removed. */
export class PaymentResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ enum: ['CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA'] })
  method!: string;
  @ApiProperty({ enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'] })
  status!: string;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;
  @ApiProperty({ type: String, nullable: true })
  instruction!: string | null;
  @ApiProperty({ type: String, nullable: true })
  gatewayData!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  failedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  refundedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  refundReason!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  refundedAmount!: number | null;
  @ApiProperty({ enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] })
  refundApproval!: string;
  @ApiProperty({ type: Number, nullable: true })
  cashReceived!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  changeGiven!: number | null;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `CashCollectedSummary` exactly — generated for audit D-6, no field added or removed. */
export class CashCollectedResponseDto {
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors `OrderCashRow` exactly — generated for audit D-6, no field added or removed. */
export class OrderCashRowResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: Number })
  amountIdr!: number;
}

/** Mirrors `cashCollectedByOrder` exactly — generated for audit D-6, no field added or removed. */
export class CashByOrderResponseDto {
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: [OrderCashRowResponseDto] })
  byOrder!: OrderCashRowResponseDto[];
}

/** Mirrors `UnsettledMethodAggregate` exactly — generated for audit D-6, no field added or removed. */
export class UnsettledMethodAggregateResponseDto {
  @ApiProperty({ enum: ['CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA'] })
  method!: string;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class WebhookResponseDto {
  @ApiProperty({ type: Boolean })
  handled!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Webhook2ResponseDto {
  @ApiProperty({ type: Boolean })
  handled!: boolean;
}

/** Mirrors `Page<PaymentRecord>` — the paged envelope this route already returns. */
export class RefundQueueRowResponseDto extends PaymentResponseDto {
  /** §G-3: the order's HM-… number, resolved from order-service. Null when unresolved. */
  @ApiProperty({ type: String, nullable: true })
  orderNumber!: string | null;
}

/** The refund queue's page — same envelope, rows carrying the order number. */
export class PagedRefundQueueResponseDto {
  @ApiProperty({ type: [RefundQueueRowResponseDto] })
  items!: RefundQueueRowResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

export class PagedPaymentResponseDto {
  @ApiProperty({ type: [PaymentResponseDto] })
  items!: PaymentResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Webhook3ResponseDto {
  @ApiProperty({ type: Boolean })
  handled!: boolean;
}
