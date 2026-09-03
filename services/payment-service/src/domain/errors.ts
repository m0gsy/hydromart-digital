import { DomainError, HTTP_STATUS } from '@hydromart/platform';

import { PaymentStatus } from './payment';

export class PaymentNotFoundError extends DomainError {
  readonly code = 'PAYMENT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Payment not found.');
  }
}

/** An order already has an active (PENDING/PAID) payment. */
export class PaymentAlreadyExistsError extends DomainError {
  readonly code = 'PAYMENT_ALREADY_EXISTS';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This order already has an active payment.');
  }
}

export class InvalidPaymentTransitionError extends DomainError {
  readonly code = 'PAYMENT_INVALID_TRANSITION';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Cannot move a payment from ${from} to ${to}.`);
  }
}

export class PaymentNotRefundableError extends DomainError {
  readonly code = 'PAYMENT_NOT_REFUNDABLE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(status: PaymentStatus) {
    super(`A payment in status ${status} cannot be refunded.`);
  }
}

/** The gateway is unreachable or not configured for an online method. */
export class GatewayUnavailableError extends DomainError {
  readonly code = 'PAYMENT_GATEWAY_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Could not reach the payment provider. Please try again.');
  }
}

/** Approve/reject was called on a refund that is not awaiting HQ approval. */
export class RefundNotPendingError extends DomainError {
  readonly code = 'REFUND_NOT_PENDING';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This refund is not awaiting approval.');
  }
}

/**
 * CA-2-34: a cancelled order that was paid gets its money back, full stop.
 *
 * Refusing a refund used to be available on any queued row. On a CANCELLED order that
 * left the customer's money with the business with no cash back, no store credit, and
 * nothing said to them — the order was over and the money simply stayed. Rejection is now
 * for disputes on orders that are still standing; a cancelled one is not a judgement call.
 */
export class RefundOnCancelledOrderError extends DomainError {
  readonly code = 'REFUND_CANCELLED_ORDER';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super(
      'Pesanan ini sudah dibatalkan, jadi refundnya tidak bisa ditolak — uang pelanggan harus dikembalikan.',
    );
  }
}

/**
 * CA-2-34: the order behind this refund could not be read, so we cannot prove it was NOT
 * cancelled. Refusing is the answer that cannot take a customer's money by accident.
 */
export class RefundOrderUnreadableError extends DomainError {
  readonly code = 'REFUND_ORDER_UNREADABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Status pesanan tidak terbaca, jadi penolakan refund tidak bisa diproses. Coba lagi.');
  }
}

/** COD cash handed over is less than the amount due — cannot settle short. */
export class CashShortError extends DomainError {
  readonly code = 'PAYMENT_CASH_SHORT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(due: number, received: number) {
    super(`Cash received (${received}) is less than the amount due (${due}).`);
  }
}

/** Client-supplied amount does not match the authoritative order total (SEC-1). */
export class PaymentAmountMismatchError extends DomainError {
  readonly code = 'PAYMENT_AMOUNT_MISMATCH';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(expected: number, provided: number) {
    super(`Payment amount (${provided}) does not match the order total (${expected}).`);
  }
}

/** Webhook signature did not verify. */
export class InvalidWebhookSignatureError extends DomainError {
  readonly code = 'PAYMENT_INVALID_SIGNATURE';
  readonly status = HTTP_STATUS.UNAUTHORIZED;
  constructor() {
    super('Invalid webhook signature.');
  }
}
