import { DomainError, HTTP_STATUS } from '@hydromart/platform';

import { DeliveryStatus } from './delivery-status';

export class DeliveryNotFoundError extends DomainError {
  readonly code = 'DELIVERY_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Delivery not found.');
  }
}

/** An order already has a delivery assignment. */
export class DeliveryAlreadyExistsError extends DomainError {
  readonly code = 'DELIVERY_ALREADY_EXISTS';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This order already has a delivery assignment.');
  }
}

/** BR: one driver = one active order (raise MAX_ACTIVE_DELIVERIES_PER_DRIVER for multi-drop). */
export class DriverBusyError extends DomainError {
  readonly code = 'DELIVERY_DRIVER_BUSY';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This driver already has the maximum number of active deliveries.');
  }
}

export class InvalidDeliveryTransitionError extends DomainError {
  readonly code = 'DELIVERY_INVALID_TRANSITION';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(from: DeliveryStatus, to: DeliveryStatus) {
    super(`Cannot move a delivery from ${from} to ${to}.`);
  }
}

/** A driver acted on a delivery that is not theirs. */
export class NotAssignedDriverError extends DomainError {
  readonly code = 'DELIVERY_NOT_YOUR_DELIVERY';
  readonly status = HTTP_STATUS.FORBIDDEN;
  constructor() {
    super('This delivery is assigned to another driver.');
  }
}

/** A location ping was sent for a delivery that is already delivered or failed. */
export class DeliveryNotActiveError extends DomainError {
  readonly code = 'DELIVERY_NOT_ACTIVE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Location can only be reported while a delivery is in progress.');
  }
}

/** Advancing the order on order-service failed (rejected transition or unreachable). */
export class OrderCoordinationError extends DomainError {
  readonly code = 'DELIVERY_ORDER_SYNC_FAILED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Could not update the order for this delivery. Please try again.');
  }
}

export class ShiftNotFoundError extends DomainError {
  readonly code = 'SHIFT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('No open shift found.');
  }
}

/** A courier tried to check in while a shift is still open (they must check out first). */
export class ShiftAlreadyOpenError extends DomainError {
  readonly code = 'SHIFT_ALREADY_OPEN';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('You already have an open shift. Check out before starting a new one.');
  }
}

/** Check-in was attempted away from the depot (design 3a: "Di lokasi depot · 12 m"). */
export class NotAtDepotError extends DomainError {
  readonly code = 'SHIFT_NOT_AT_DEPOT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(distanceMeters: number, radiusMeters: number) {
    super(
      `You are ${Math.round(distanceMeters)} m from the depot. Check in within ${radiusMeters} m.`,
    );
  }
}

export class InvalidShiftTransitionError extends DomainError {
  readonly code = 'SHIFT_INVALID_TRANSITION';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(from: string, to: string) {
    super(`Cannot move a shift from ${from} to ${to}.`);
  }
}

/** Dispatch tried to assign a courier who is not checked in and ONLINE. */
export class DriverNotOnShiftError extends DomainError {
  readonly code = 'DELIVERY_DRIVER_NOT_ON_SHIFT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This courier is not checked in and available.');
  }
}

/** A no-show was declared before enough contact attempts / wait time (design 5a). */
export class NoShowNotEligibleError extends DomainError {
  readonly code = 'DELIVERY_NO_SHOW_NOT_ELIGIBLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(minAttempts: number, minWaitSeconds: number) {
    super(
      `A no-show needs at least ${minAttempts} contact attempts and ${minWaitSeconds}s of waiting.`,
    );
  }
}

/** The depot could not be read, so check-in location cannot be verified. */
export class DepotLookupError extends DomainError {
  readonly code = 'SHIFT_DEPOT_LOOKUP_FAILED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Could not verify the depot location. Please try again.');
  }
}
