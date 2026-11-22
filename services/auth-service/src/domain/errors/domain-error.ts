/**
 * Base class for all domain errors. Each carries a stable machine-readable `code`
 * and an HTTP `status` hint that the interface layer maps to a response
 * (see AllExceptionsFilter). Domain code never imports HTTP/framework types, so
 * the status is expressed as a plain number.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  /** Structured facts the caller needs to act on the error, sent beside the message. */
  readonly details?: Record<string, unknown>;
  /**
   * A 5xx that reports a switch the operator left off (a blank key), not a fault: the caller
   * still gets the status and code, but nobody is paged. Anyone can call a public route, so a
   * kill switch that pages would let a stranger ring the on-call channel at will.
   */
  readonly switchedOff?: boolean;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
