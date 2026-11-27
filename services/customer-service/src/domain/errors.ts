import { DomainError, HTTP_STATUS } from '@hydromart/platform';

import type { RefusalReason } from './b2b-prospect';

export class AddressNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_ADDRESS_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Address not found.');
  }
}

/** A pin is both halves or neither, and never 0,0 (the Atlantic: what an emptied field becomes). */
export class AddressPinInvalidError extends DomainError {
  readonly code = 'CUSTOMER_ADDRESS_PIN_INVALID';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Pin lokasi tidak valid: isi garis lintang dan bujur bersamaan, dan bukan 0,0.');
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

/**
 * K4.2: a future `effectiveAt` was given but nothing about the agen's price changed.
 *
 * Accepting it would write nothing and answer 200, and staff would go away believing a
 * change is scheduled for a date on which nothing will happen. The one silence this
 * feature exists to end, reintroduced by the feature itself.
 */
export class NothingToScheduleError extends DomainError {
  readonly code = 'CUSTOMER_RESELLER_NOTHING_TO_SCHEDULE';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor() {
    super('Tanggal berlaku diisi tapi tidak ada perubahan harga atau status agen yang dijadwalkan');
  }
}

/** A prospect that does not exist, or that this caller may not reach (never confirm which). */
export class ProspectNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_PROSPECT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Prospek tidak ditemukan');
  }
}

/** Intake said no: licence, do-not-contact, already a customer, or already known. */
export class ProspectRefusedError extends DomainError {
  readonly code = 'CUSTOMER_PROSPECT_REFUSED';
  readonly status = HTTP_STATUS.CONFLICT;
  override readonly details: { reason: RefusalReason };
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
    this.details = { reason };
  }
}

/** The row cannot be read as a prospect (no pin, bad category, no name). */
export class ProspectInvalidError extends DomainError {
  readonly code = 'CUSTOMER_PROSPECT_INVALID';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(message: string) {
    super(message);
  }
}

export class ProspectTransitionError extends DomainError {
  readonly code = 'CUSTOMER_PROSPECT_TRANSITION';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(message = 'Status prospek ini tidak bisa diubah ke status tersebut') {
    super(message);
  }
}

/** Somebody else changed the row since the caller read it. */
export class ProspectStaleError extends DomainError {
  readonly code = 'CUSTOMER_PROSPECT_STALE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Prospek ini baru saja diubah orang lain. Muat ulang lalu coba lagi.');
  }
}
