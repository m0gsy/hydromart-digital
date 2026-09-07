import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class ReferralCodeNotFoundError extends DomainError {
  readonly code = 'REFERRAL_CODE_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Referral code not found.');
  }
}

export class SelfReferralError extends DomainError {
  readonly code = 'REFERRAL_SELF';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('You cannot use your own referral code.');
  }
}

/**
 * CA-3-40 — owner decision 2026-09-04: a new customer is one who has never had a single
 * order reach COMPLETED. Account age does not count.
 */
export class NotANewCustomerError extends DomainError {
  readonly code = 'REFERRAL_NOT_NEW_CUSTOMER';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Kode rujukan hanya untuk pelanggan baru — kamu sudah pernah menyelesaikan pesanan.');
  }
}

/**
 * order-service could not be asked. Refusing is the decision, not a bug: qualification pays
 * 750 points that cannot be reclaimed, so an unknown answer must not be read as "new".
 */
export class OrderHistoryUnavailableError extends DomainError {
  readonly code = 'REFERRAL_ORDER_HISTORY_UNAVAILABLE';
  readonly status = HTTP_STATUS.SERVICE_UNAVAILABLE;
  constructor() {
    super('Tidak bisa memeriksa riwayat pesanan saat ini. Coba lagi sebentar.');
  }
}

export class AlreadyReferredError extends DomainError {
  readonly code = 'REFERRAL_ALREADY_REFERRED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('You have already redeemed a referral code.');
  }
}
