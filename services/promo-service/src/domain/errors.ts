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
