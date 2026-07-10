import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class AddressNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_ADDRESS_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Address not found.');
  }
}

/** BR-004: a customer may have at most N addresses. */
export class AddressLimitError extends DomainError {
  readonly code = 'CUSTOMER_ADDRESS_LIMIT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(max: number) {
    super(`You can save at most ${max} addresses.`);
  }
}

export class ProfileNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_PROFILE_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Customer profile not found.');
  }
}
