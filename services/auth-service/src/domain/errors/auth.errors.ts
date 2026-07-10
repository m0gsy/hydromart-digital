import { DomainError } from './domain-error';

/** Standard HTTP status codes referenced by domain errors (PRD §21). */
const HTTP = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY: 429,
} as const;

export class InvalidPhoneNumberError extends DomainError {
  readonly code = 'AUTH_INVALID_PHONE';
  readonly status = HTTP.UNPROCESSABLE;
  constructor(value: string) {
    super(`"${value}" is not a valid Indonesian mobile number.`);
  }
}

/** BR-001: a phone number belongs to at most one account. */
export class PhoneAlreadyRegisteredError extends DomainError {
  readonly code = 'AUTH_PHONE_TAKEN';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('This phone number is already registered.');
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'AUTH_EMAIL_TAKEN';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('This email address is already registered.');
  }
}

export class CustomerNotFoundError extends DomainError {
  readonly code = 'AUTH_CUSTOMER_NOT_FOUND';
  readonly status = HTTP.NOT_FOUND;
  constructor(message = 'No account exists for the given identifier.') {
    super(message);
  }
}

export class AccountNotActiveError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_NOT_ACTIVE';
  readonly status = HTTP.FORBIDDEN;
  constructor(message = 'This account is not active.') {
    super(message);
  }
}

/** OTP challenge could not be found, is expired, or already consumed. */
export class OtpInvalidError extends DomainError {
  readonly code = 'AUTH_OTP_INVALID';
  readonly status = HTTP.UNAUTHORIZED;
  constructor(message = 'The verification code is invalid or has expired.') {
    super(message);
  }
}

/** BR-002 boundary: too many wrong attempts for one OTP challenge. */
export class OtpMaxAttemptsError extends DomainError {
  readonly code = 'AUTH_OTP_MAX_ATTEMPTS';
  readonly status = HTTP.TOO_MANY;
  constructor() {
    super('Too many incorrect attempts. Please request a new code.');
  }
}

export class OtpResendCooldownError extends DomainError {
  readonly code = 'AUTH_OTP_COOLDOWN';
  readonly status = HTTP.TOO_MANY;
  constructor(retryAfterSeconds: number) {
    super(`Please wait ${retryAfterSeconds}s before requesting another code.`);
  }
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'AUTH_INVALID_REFRESH_TOKEN';
  readonly status = HTTP.UNAUTHORIZED;
  constructor(message = 'The session is invalid or has expired.') {
    super(message);
  }
}

export class InvalidGoogleTokenError extends DomainError {
  readonly code = 'AUTH_INVALID_GOOGLE_TOKEN';
  readonly status = HTTP.UNAUTHORIZED;
  constructor(message = 'The Google credential could not be verified.') {
    super(message);
  }
}
