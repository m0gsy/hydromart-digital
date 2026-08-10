import { DomainError, HTTP_STATUS } from '@hydromart/platform';

import { OrderStatus } from './order-status';

export class OrderNotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor() {
    super('Order not found.');
  }
}

/**
 * A checkout carrying an `Idempotency-Key` this customer has already used (B-13). Raised by
 * the repository off the unique index, never surfaced to the caller: the service turns it
 * back into the order the first attempt placed, which is what the retry was asking for.
 */
export class DuplicateCheckoutError extends DomainError {
  readonly code = 'ORDER_DUPLICATE_CHECKOUT';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This checkout was already placed.');
  }
}

/**
 * The order moved on between being read and being written (H-4).
 *
 * 409, not 422: the transition the caller asked for was legal when they asked. Somebody
 * else got there first, and re-reading the order will show them what actually happened.
 */
export class StaleOrderStatusError extends DomainError {
  readonly code = 'ORDER_STATUS_STALE';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This order was already updated by someone else. Reload and try again.');
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
 * Express delivery was asked for at a depot that does not offer it. Rejecting beats
 * quietly placing a scheduled order: someone who chose "antar sekarang" wanted the next
 * hour, and a silent downgrade sells them something else at the same price.
 */
export class ExpressUnavailableError extends DomainError {
  readonly code = 'ORDER_EXPRESS_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This depot is not taking express deliveries right now. Please pick a time slot.');
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

/**
 * No depot could be resolved for the order and the caller did not pick one. An
 * order with no depot is invisible to every depot queue and reserves no stock, so
 * checkout refuses it instead of silently placing an unfulfillable order.
 */
export class DepotRequiredError extends DomainError {
  readonly code = 'ORDER_DEPOT_REQUIRED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Pick a depot: this address has no map pin, so we cannot route it automatically.');
  }
}

/** Manual depot assignment only fills a blank — an order already routed keeps its depot. */
export class OrderAlreadyRoutedError extends DomainError {
  readonly code = 'ORDER_ALREADY_ROUTED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('This order already has a depot.');
  }
}

/** The depot the caller picked is unknown or not active. */
export class DepotUnavailableError extends DomainError {
  readonly code = 'ORDER_DEPOT_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('That depot is not available right now. Please pick another one.');
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

/** A reseller's order already gets agen pricing — vouchers cannot stack on top of it. */
export class ResellerVoucherNotAllowedError extends DomainError {
  readonly code = 'ORDER_RESELLER_VOUCHER_FORBIDDEN';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Reseller pricing already applies — vouchers cannot be used on this order.');
  }
}

/* ---------- Counter void ---------- */

/** Only a counter sale is voided at the till; a delivery order goes through refunds. */
export class NotACounterSaleError extends DomainError {
  readonly code = 'ORDER_NOT_A_COUNTER_SALE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Hanya penjualan konter yang bisa dibatalkan di kasir. Pesanan antar lewat proses refund.');
  }
}

/** The sale belongs to a day already reconciled — reversing it would move settled money. */
export class VoidWindowClosedError extends DomainError {
  readonly code = 'ORDER_VOID_WINDOW_CLOSED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Penjualan ini bukan hari ini, jadi tidak bisa dibatalkan di kasir. Ajukan refund.');
  }
}

/** The money could not be given back, so the sale must keep standing. */
export class PaymentReversalFailedError extends DomainError {
  readonly code = 'ORDER_PAYMENT_REVERSAL_FAILED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Pembayaran belum bisa dikembalikan, jadi penjualan tidak dibatalkan. Coba lagi sebentar.');
  }
}

/** Two cashiers voiding the same sale: only the first may restock and refund it. */
export class OrderAlreadyVoidedError extends DomainError {
  readonly code = 'ORDER_ALREADY_VOIDED';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor() {
    super('Penjualan ini sudah dibatalkan.');
  }
}

/** No open cashier shift: the cash would enter a drawer nobody is answerable for. */
export class NoOpenShiftError extends DomainError {
  readonly code = 'ORDER_NO_OPEN_SHIFT';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Buka shift kasir dulu sebelum mencatat penjualan di konter.');
  }
}

/**
 * §I: the cashier typed a phone and customer-service could not say who it belongs to.
 *
 * Fail CLOSED, deliberately, even though every other counter coordination call fails open.
 * The replay guard (B-13) is keyed by customer id, so booking this sale to the anonymous
 * sentinel would hide a retry of a sale already recorded under the resolved buyer — and
 * the till would sell the same goods twice. Refusing is recoverable: the cashier taps
 * Bayar again, or clears the phone field and rings it up anonymously.
 */
export class CounterBuyerUnresolvedError extends DomainError {
  readonly code = 'ORDER_COUNTER_BUYER_UNRESOLVED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super(
      'Nomor pembeli belum bisa dicek sekarang. Coba lagi, atau kosongkan nomornya untuk jual tanpa nama.',
    );
  }
}

/** A voucher lives in one buyer's wallet — an anonymous counter sale has none to spend. */
export class AnonymousVoucherNotAllowedError extends DomainError {
  readonly code = 'ORDER_ANONYMOUS_VOUCHER_FORBIDDEN';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Enter the buyer’s phone number first — a voucher belongs to an account.');
  }
}

/** Nothing is delivered at the counter, so a free-shipping voucher would burn for nothing. */
export class ShippingVoucherAtCounterError extends DomainError {
  readonly code = 'ORDER_SHIPPING_VOUCHER_AT_COUNTER';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('This voucher only waives delivery, and a counter sale has none. Keep it for a delivery order.');
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

/**
 * Stock could not be reserved because depot-service could not be reached or answered
 * with something other than a verdict (B-6b).
 *
 * The same reasoning as CatalogUnavailableError, applied to stock instead of price: if we
 * cannot confirm the reservation, we do not get to assume it succeeded. Reserve used to
 * fail OPEN on everything except an explicit 422, so a depot-service outage silently
 * converted every order placed in that window into an unreserved one — the ledger and the
 * physical shelf diverged with no error anywhere, and the divergence compounded with the
 * settle race (B-5).
 */
export class StockCheckUnavailableError extends DomainError {
  readonly code = 'ORDER_STOCK_CHECK_UNAVAILABLE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Could not confirm stock right now. Please try again.');
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

/**
 * A water meter only counts up. A closing reading below its opening means a typo
 * or a swapped pair, and accepting it would report a negative day of production.
 */
export class MeterReadingBackwardsError extends DomainError {
  readonly code = 'ORDER_METER_READING_BACKWARDS';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(which: 'produksi' | 'air baku') {
    super(`Angka meteran ${which} akhir tidak boleh lebih kecil dari angka awal.`);
  }
}

/** A closing-only write for a day whose opening reading was never entered. */
export class MeterReadingNotOpenedError extends DomainError {
  readonly code = 'ORDER_METER_READING_NOT_OPENED';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Meteran awal hari ini belum dicatat, jadi meteran akhir belum bisa disimpan.');
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

/**
 * A report asked for more orders than one response is allowed to materialise (audit H-46).
 * The alternative is silently truncating the window, which returns a revenue number that
 * looks right and is not — a narrower range is a worse report, a wrong one is a liability.
 */
export class ReportRangeTooLargeError extends DomainError {
  readonly code = 'ORDER_REPORT_RANGE_TOO_LARGE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(maxOrders: number) {
    super(`This range covers more than ${maxOrders} orders. Narrow the date range.`);
  }
}
