import { DomainError, HTTP_STATUS } from '@hydromart/platform';

import { OrderStatus } from './order-status';

export class OrderNotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Order not found.');
  }
}

export class EmptyCartError extends DomainError {
  readonly code = 'ORDER_CART_EMPTY';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Your cart is empty.');
  }
}

/** The order subtotal is below the fulfilling depot's minimum order amount. */
export class BelowMinimumOrderError extends DomainError {
  readonly code = 'ORDER_BELOW_MINIMUM';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(minimum: number) {
    super(`This depot has a minimum order of ${minimum}. Please add more items.`);
  }
}

/**
 * The delivery address is outside every active depot's service radius. Only
 * thrown when the depot directory was reachable and returned depots — a directory
 * outage (or a platform with no depots configured) stays fail-open and unrouted.
 */
export class OutOfServiceAreaError extends DomainError {
  readonly code = 'ORDER_OUT_OF_SERVICE_AREA';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This delivery address is outside our service area. No depot can deliver here.');
  }
}

/** A supplied voucher could not be applied (invalid, or promo-service unreachable). */
export class VoucherRejectedError extends DomainError {
  readonly code = 'ORDER_VOUCHER_REJECTED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(message = 'This voucher could not be applied.') {
    super(message);
  }
}

/** The fulfilling depot cannot hold enough stock for the order (oversell prevention). */
export class InsufficientStockError extends DomainError {
  readonly code = 'ORDER_INSUFFICIENT_STOCK';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(message = 'Some items are out of stock at the fulfilling depot.') {
    super(message);
  }
}

/** A cart item references a product that no longer exists or is inactive. */
export class ProductUnavailableError extends DomainError {
  readonly code = 'ORDER_PRODUCT_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(productId: string) {
    super(`Product ${productId} is no longer available.`);
  }
}

/** The catalog could not be reached to price the order (BR: never trust client prices). */
export class CatalogUnavailableError extends DomainError {
  readonly code = 'ORDER_CATALOG_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Could not verify product prices right now. Please try again.');
  }
}

/** BR-006: cancellation is only allowed before a driver is assigned. */
export class OrderNotCancellableError extends DomainError {
  readonly code = 'ORDER_NOT_CANCELLABLE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(status: OrderStatus) {
    super(`An order in status ${status} can no longer be cancelled.`);
  }
}

/** Spec 7b: subscription not found (or not owned by the caller). */
export class SubscriptionNotFoundError extends DomainError {
  readonly code = 'SUBSCRIPTION_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Subscription not found.');
  }
}

/** Spec 7b: the requested action is not valid for a cancelled subscription. */
export class SubscriptionNotActionableError extends DomainError {
  readonly code = 'SUBSCRIPTION_NOT_ACTIONABLE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('A cancelled subscription can no longer be changed.');
  }
}

/** Spec 7c: an order can only be reviewed once it has been delivered/completed. */
export class OrderNotReviewableError extends DomainError {
  readonly code = 'ORDER_NOT_REVIEWABLE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(status: OrderStatus) {
    super(`An order in status ${status} cannot be reviewed yet.`);
  }
}

/** Spec 7c: one review per order. */
export class OrderAlreadyReviewedError extends DomainError {
  readonly code = 'ORDER_ALREADY_REVIEWED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This order has already been reviewed.');
  }
}

/** BR-012: the requested status transition is not legal from the current status. */
export class InvalidStatusTransitionError extends DomainError {
  readonly code = 'ORDER_INVALID_STATUS_TRANSITION';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot move an order from ${from} to ${to}.`);
  }
}
