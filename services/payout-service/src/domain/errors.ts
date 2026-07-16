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

export class InvalidCommissionSchemeError extends DomainError {
  readonly code = 'COMMISSION_INVALID_SCHEME';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor(message = 'Commission percentage must be between 0 and 100.') {
    super(message);
  }
}
