import { DomainError, HTTP_STATUS } from '@hydromart/platform';

// HD-23: the monthly partner bill.

export class PartnerBillMonthInvalidError extends DomainError {
  readonly code = 'PARTNER_BILL_MONTH_INVALID';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor(month: string) {
    super(`Month ${month} is not a YYYY-MM month.`);
  }
}

/** A bill covers a closed month: drafting the running one would bill commission still being earned. */
export class PartnerBillMonthOpenError extends DomainError {
  readonly code = 'PARTNER_BILL_MONTH_NOT_CLOSED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(month: string) {
    super(`Month ${month} has not closed yet; bills are made for closed months only.`);
  }
}

export class PartnerBillNotFoundError extends DomainError {
  readonly code = 'PARTNER_BILL_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Partner bill not found.');
  }
}

export class PartnerBillNotDraftError extends DomainError {
  readonly code = 'PARTNER_BILL_NOT_DRAFT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Only a draft bill can be approved.');
  }
}

export class PartnerBillVoidedError extends DomainError {
  readonly code = 'PARTNER_BILL_VOID';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This bill is already void.');
  }
}

/** The bill says where to pay, so it is not sent without the official account. */
export class BankAccountMissingError extends DomainError {
  readonly code = 'BANK_ACCOUNT_MISSING';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('The franchisor has no official bank account yet. Enter it on Legal entities, then approve.');
  }
}

export class PartnerBillNoRecipientsError extends DomainError {
  readonly code = 'PARTNER_BILL_NO_RECIPIENTS';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('No depot owner account could be found for this bill.');
  }
}

/** depot-service or crm-service could not answer: nothing was changed, retry. */
export class PartnerBillSourceUnavailableError extends DomainError {
  readonly code = 'PARTNER_BILL_SOURCE_UNAVAILABLE';
  readonly status = HTTP_STATUS.SERVICE_UNAVAILABLE;
  constructor(what: string) {
    super(`${what} could not be reached; nothing was changed, try again.`);
  }
}
