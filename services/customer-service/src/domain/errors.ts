import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class AddressNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_ADDRESS_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Address not found.');
  }
}

/** BR-004: a customer may have at most N addresses. */
export class AddressLimitError extends DomainError {
  readonly code = 'CUSTOMER_ADDRESS_LIMIT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(max: number) {
    super(`You can save at most ${max} addresses.`);
  }
}

/**
 * Audit DB-2 (create path): two concurrent "add as primary" both cleared the old
 * primary then inserted, colliding on the partial unique index
 * `addresses_one_primary_per_customer`. The loser's P2002 maps here → 409.
 */
export class PrimaryAddressConflictError extends DomainError {
  readonly code = 'CUSTOMER_PRIMARY_ADDRESS_CONFLICT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Another primary address was set at the same time. Please retry.');
  }
}

export class PaymentMethodNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_PAYMENT_METHOD_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Payment method not found.');
  }
}

/** Default-payment-method counterpart of PrimaryAddressConflictError (409). */
export class DefaultPaymentMethodConflictError extends DomainError {
  readonly code = 'CUSTOMER_DEFAULT_PAYMENT_METHOD_CONFLICT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Another default payment method was set at the same time. Please retry.');
  }
}

export class ProfileNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_PROFILE_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Customer profile not found.');
  }
}

export class ResellerNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_RESELLER_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Reseller tidak ditemukan');
  }
}

export class ResellerExistsError extends DomainError {
  readonly code = 'CUSTOMER_RESELLER_EXISTS';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Customer ini sudah terdaftar sebagai reseller');
  }
}

export class CustomerNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Customer tidak ditemukan');
  }
}
