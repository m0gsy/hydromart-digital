/**
 * Base class for domain errors across all Hydromart services. Carries a stable
 * machine-readable `code` and an HTTP `status` the interface layer maps to a
 * response (see AllExceptionsFilter). Domain code never imports framework types.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Standard HTTP status codes referenced by domain errors (PRD §21). */
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY: 429,
} as const;
