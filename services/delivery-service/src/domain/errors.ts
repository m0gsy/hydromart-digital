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

/** Advancing the order on order-service failed (rejected transition or unreachable). */
export class OrderCoordinationError extends DomainError {
  readonly code = 'DELIVERY_ORDER_SYNC_FAILED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Could not update the order for this delivery. Please try again.');
  }
}
