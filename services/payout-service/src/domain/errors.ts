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
