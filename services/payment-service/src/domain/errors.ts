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
