import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class VoucherNotFoundError extends DomainError {
  readonly code = 'VOUCHER_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Voucher not found.');
  }
}

export class DuplicateVoucherCodeError extends DomainError {
  readonly code = 'VOUCHER_CODE_TAKEN';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(voucherCode: string) {
    super(`Voucher code "${voucherCode}" is already in use.`);
  }
}

export class InvalidVoucherValueError extends DomainError {
  readonly code = 'VOUCHER_VALUE_INVALID';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(reason = 'A percentage or fixed voucher needs a positive value.') {
    super(reason);
  }
}

/**
 * CA-2-65: a depot's voucher, spent somewhere else.
 *
 * A depot manager requests a promo for their own area; HQ approves it. Before the voucher
 * carried a depot, the approval created a code every customer in the network could spend —
 * funded by the depot that asked for one promo on their own street.
 *
 * Refused at QUOTE, not only at redemption: `redeem` fails OPEN by design so a paid order
 * is never blocked, which means a check that only ran there would price the discount in and
 * then let it stand.
 */
export class VoucherWrongDepotError extends DomainError {
  readonly code = 'VOUCHER_WRONG_DEPOT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Voucher ini hanya berlaku di depot tertentu.');
  }
}

export class PromotionNotFoundError extends DomainError {
  readonly code = 'PROMOTION_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Promotion not found.');
  }
}

export class VoucherInactiveError extends DomainError {
  readonly code = 'VOUCHER_INACTIVE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher is no longer active.');
  }
}

export class VoucherNotStartedError extends DomainError {
  readonly code = 'VOUCHER_NOT_STARTED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher is not valid yet.');
  }
}

export class VoucherExpiredError extends DomainError {
  readonly code = 'VOUCHER_EXPIRED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher has expired.');
  }
}

export class MinSpendNotMetError extends DomainError {
  readonly code = 'VOUCHER_MIN_SPEND';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(minSpend: number) {
    super(`Your order must be at least ${minSpend} to use this voucher.`);
  }
}

export class VoucherUsageExceededError extends DomainError {
  readonly code = 'VOUCHER_USAGE_EXCEEDED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher has reached its usage limit.');
  }
}

export class VoucherCustomerLimitReachedError extends DomainError {
  readonly code = 'VOUCHER_CUSTOMER_LIMIT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('You have already used this voucher the maximum number of times.');
  }
}

export class VoucherBudgetExhaustedError extends DomainError {
  readonly code = 'VOUCHER_BUDGET_EXHAUSTED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher has spent its full discount budget.');
  }
}

export class VoucherRequestNotFoundError extends DomainError {
  readonly code = 'VOUCHER_REQUEST_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Voucher request not found.');
  }
}

export class VoucherRequestDecidedError extends DomainError {
  readonly code = 'VOUCHER_REQUEST_DECIDED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher request has already been decided.');
  }
}
