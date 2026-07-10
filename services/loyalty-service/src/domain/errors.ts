import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class LoyaltyAccountNotFoundError extends DomainError {
  readonly code = 'LOYALTY_ACCOUNT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Loyalty account not found.');
  }
}

export class InvalidAdjustmentError extends DomainError {
  readonly code = 'LOYALTY_INVALID_ADJUSTMENT';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor(message = 'Adjustment would drive the balance below zero.') {
    super(message);
  }
}
