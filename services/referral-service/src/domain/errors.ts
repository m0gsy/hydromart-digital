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

export class AlreadyReferredError extends DomainError {
  readonly code = 'REFERRAL_ALREADY_REFERRED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('You have already redeemed a referral code.');
  }
}
