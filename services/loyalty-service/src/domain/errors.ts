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

export class RewardItemNotFoundError extends DomainError {
  readonly code = 'LOYALTY_REWARD_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('This reward is not available.');
  }
}

export class InsufficientPointsError extends DomainError {
  readonly code = 'LOYALTY_INSUFFICIENT_POINTS';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('You do not have enough points to redeem this reward.');
  }
}

export class RewardOutOfStockError extends DomainError {
  readonly code = 'LOYALTY_REWARD_OUT_OF_STOCK';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This reward is out of stock.');
  }
}
