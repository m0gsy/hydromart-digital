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

/** Only a sent bill can be paid: a draft was never asked for and a void one never will be. */
export class PartnerBillNotSentError extends DomainError {
  readonly code = 'PARTNER_BILL_NOT_SENT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Only a sent bill can be marked paid.');
  }
}

/** A paid bill is settled: voiding it would hide a payment that was received. */
export class PartnerBillPaidError extends DomainError {
  readonly code = 'PARTNER_BILL_PAID';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This bill is already paid and cannot be voided.');
  }
}

/** Money cannot have arrived on a day that has not come yet. */
export class PartnerBillPaidOnFutureError extends DomainError {
  readonly code = 'PARTNER_BILL_PAID_ON_FUTURE';
  readonly status = HTTP_STATUS.BAD_REQUEST;
  constructor() {
    super('The paid day cannot be later than today.');
  }
}

/** The bill is being sent: it cannot be voided until it is sent (then void it) or the send is retried. */
export class PartnerBillSendingError extends DomainError {
  readonly code = 'PARTNER_BILL_SENDING';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This bill is being sent. Approve again to finish sending it, then void it if it is wrong.');
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
