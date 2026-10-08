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

/**
 * Item 5 (B): the voucher is limited to one product or category and the basket has none of it.
 *
 * Refused at QUOTE for the same reason the depot check is: `redeem` fails OPEN, so a rule that
 * only ran there would price the discount in and then let it stand.
 */
export class VoucherNotApplicableError extends DomainError {
  readonly code = 'VOUCHER_NOT_APPLICABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Voucher ini hanya berlaku untuk produk tertentu yang tidak ada di keranjang.');
  }
}

/**
 * Item 5 (B): a scoped voucher was quoted with no line items. The caller cannot say which part
 * of the basket qualifies, so the safe answer is no discount rather than the whole order's.
 */
export class VoucherLinesRequiredError extends DomainError {
  readonly code = 'VOUCHER_LINES_REQUIRED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Voucher ini berlaku untuk produk tertentu; rincian keranjang diperlukan.');
  }
}

/**
 * PRM-4: the code is real, but it was given to somebody else.
 *
 * A voucher granted to one customer used to be spendable by every customer who learned the
 * code — a birthday voucher, a complaint apology, a reactivation offer, all network-wide
 * the moment one person forwarded the message.
 */
export class VoucherNotYoursError extends DomainError {
  readonly code = 'VOUCHER_NOT_YOURS';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Voucher ini khusus untuk pelanggan yang menerimanya.');
  }
}

export class PromotionNotFoundError extends DomainError {
  readonly code = 'PROMOTION_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Promotion not found.');
  }
}

export class PromoRuleNotFoundError extends DomainError {
  readonly code = 'PROMO_RULE_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Aturan promo tidak ditemukan.');
  }
}

export class PromoRuleValidationError extends DomainError {
  readonly code = 'PROMO_RULE_VALIDATION';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor(message: string) {
    super(message);
  }
}

/** Fix I-4: deleting a rule that has fired (PromoApplication.promoRule is onDelete: Restrict)
 * threw a raw Prisma P2003 that surfaced as a 500. Nonactivate instead of deleting a rule
 * with history. */
export class PromoRuleInUseError extends DomainError {
  readonly code = 'PROMO_RULE_IN_USE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Aturan promo ini sudah pernah dipakai — nonaktifkan saja, jangan hapus.');
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

