/**
 * Base class for all domain errors. Each carries a stable machine-readable `code`
 * and an HTTP `status` hint that the interface layer maps to a response
 * (see AllExceptionsFilter). Domain code never imports HTTP/framework types, so
 * the status is expressed as a plain number.
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
