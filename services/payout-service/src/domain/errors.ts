import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class InsufficientBalanceError extends DomainError {
  readonly code = 'PAYOUT_INSUFFICIENT_BALANCE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(available: number, requested: number) {
    super(`Withdrawal of ${requested} exceeds available balance ${available}.`);
  }
}

export class InvalidWithdrawalAmountError extends DomainError {
  readonly code = 'PAYOUT_INVALID_AMOUNT';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor() {
    super('Withdrawal amount must be greater than zero.');
  }
}

/**
 * CA-2-63: an HQ release with nowhere to send the money.
 *
 * The debit leaves the owner's balance the moment a withdrawal is requested (B-8), so a
 * record whose destination is a placeholder is money gone with no answer to "where". HQ
 * either names the account or the owner has one on file from a previous cash-out; neither
 * is a reason to write "Rilis HQ" into the destination column and carry on.
 */
export class UnknownPayoutDestinationError extends DomainError {
  readonly code = 'PAYOUT_UNKNOWN_DESTINATION';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super(
      'No destination account for this owner: they have never cashed out, so HQ must name ' +
        'the bank account this release is going to.',
    );
  }
}

export class WithdrawalNotFoundError extends DomainError {
  readonly code = 'PAYOUT_WITHDRAWAL_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Withdrawal not found.');
  }
}

/**
 * PROCESSING is the only state a withdrawal can be settled from, and settling is what makes
 * PROCESSING a stage rather than a destination. `WithdrawalStatus` has had PAID and FAILED
 * since the first migration and nothing in the service ever wrote either, so every payout
 * ever requested — courier and franchise owner alike — is still PROCESSING while the money
 * has already left the balance.
 */
export class WithdrawalNotProcessingError extends DomainError {
  readonly code = 'PAYOUT_WITHDRAWAL_NOT_PROCESSING';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(status: string) {
    super(`Withdrawal is already ${status}; only a PROCESSING withdrawal can be settled.`);
  }
}

export class InvalidRevenueAmountError extends DomainError {
  readonly code = 'PAYOUT_INVALID_REVENUE_AMOUNT';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor() {
    super('Order revenue amount must be greater than zero.');
  }
}

export class InvalidExpenseAmountError extends DomainError {
  readonly code = 'EXPENSE_INVALID_AMOUNT';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor() {
    super('Expense claim amount must be greater than zero.');
  }
}

export class ExpenseClaimNotFoundError extends DomainError {
  readonly code = 'EXPENSE_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Expense claim not found.');
  }
}

export class ExpenseClaimNotPendingError extends DomainError {
  readonly code = 'EXPENSE_NOT_PENDING';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Only a pending expense claim can be approved or rejected.');
  }
}

export class InvalidEarningRuleError extends DomainError {
  readonly code = 'EARNING_RULE_INVALID';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor(
    message = 'Earning rule needs non-negative fares and a valid peak window (0 ≤ start < end ≤ 24).',
  ) {
    super(message);
  }
}

export class InvalidCommissionSchemeError extends DomainError {
  readonly code = 'COMMISSION_INVALID_SCHEME';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor(message = 'Commission percentage must be between 0 and 100.') {
    super(message);
  }
}
