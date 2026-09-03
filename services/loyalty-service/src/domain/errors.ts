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

export class RewardRedemptionNotFoundError extends DomainError {
  readonly code = 'LOYALTY_REDEMPTION_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Penukaran hadiah tidak ditemukan.');
  }
}

/**
 * M14-03: the reward was already collected, so the points bought something real and
 * cannot come back. Deliberately NOT a 404 — the customer needs to understand why.
 */
export class RewardAlreadyUsedError extends DomainError {
  readonly code = 'LOYALTY_REDEMPTION_ALREADY_USED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Hadiah ini sudah diambil, jadi penukarannya tidak bisa dibatalkan.');
  }
}

export class RewardAlreadyCancelledError extends DomainError {
  readonly code = 'LOYALTY_REDEMPTION_ALREADY_CANCELLED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Penukaran ini sudah dibatalkan.');
  }
}

/**
 * CA-2-65: another depot handed this reward over first.
 *
 * A redemption with no collection depot shows in every depot's queue on purpose, so two
 * counters can be holding the same row. The one that loses the race must be TOLD — being
 * answered "berhasil" is what let two rewards leave two shelves against one ledger line.
 */
export class RewardAlreadyHandedOverError extends DomainError {
  readonly code = 'LOYALTY_REDEMPTION_ALREADY_HANDED_OVER';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Hadiah ini baru saja diserahkan oleh depot lain.');
  }
}

export class RewardOutOfStockError extends DomainError {
  readonly code = 'LOYALTY_REWARD_OUT_OF_STOCK';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This reward is out of stock.');
  }
}
