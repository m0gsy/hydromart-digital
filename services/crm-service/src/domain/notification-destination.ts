import { NotificationEvent } from './notification-event';

/**
 * Where a push notification should land when the user taps it.
 *
 * The pipe for this already existed end to end — `PushPayload.url` is declared, filled,
 * shipped inside the FCM `data` block and read by the tap handler. What it carried was
 * the string `'/notifications'`, for all eighteen events: an order arriving, a voucher
 * being granted and a reorder nudge all dropped the user on the same inbox and made them
 * find the thing themselves. This gives each event the screen it is actually about.
 *
 * The inbox stays as the default rather than a fallback nobody reaches: the operational
 * and HR events are staff-facing, `notify()` only pushes when a `customerId` is present,
 * and staff notifications carry none — so they never reach a device at all. Mapping them
 * to a depot console screen would be writing routes for a message that is not sent.
 *
 * Order events need the order's id, which is not otherwise in `vars` — the templates
 * quote the human-readable `orderNumber`. Passing the id alongside is deliberate and
 * harmless: `renderMessage()` only substitutes tokens the template actually contains, so
 * a var no template names is invisible in the copy. It falls back to the order list when
 * an emitter has not been taught to send one, which is what an older service still does.
 */
const INBOX = '/notifications';

const ORDER_EVENTS = new Set<NotificationEvent>([
  NotificationEvent.ORDER_RECEIVED,
  NotificationEvent.ORDER_CONFIRMED,
  NotificationEvent.ORDER_ON_DELIVERY,
  NotificationEvent.ORDER_DELIVERED,
  NotificationEvent.ORDER_COMPLETED,
  NotificationEvent.ORDER_CANCELLED,
]);

export function destinationFor(
  event: NotificationEvent,
  vars: Record<string, string> = {},
): string {
  if (ORDER_EVENTS.has(event)) {
    const id = vars.orderId;
    // `?id=` and not `/orders/<id>`: F1 turned every dynamic segment into a query
    // parameter so the app could be exported as files. The client rewrites the old shape
    // too, because notifications sent before that change are still on people's phones.
    return id ? `/orders/detail?id=${encodeURIComponent(id)}` : '/orders';
  }
  switch (event) {
    case NotificationEvent.POINTS_EARNED:
      return '/rewards';
    case NotificationEvent.VOUCHER_GRANTED:
      return '/vouchers';
    // "Your gallon is probably running low" — the point of the message is to reorder,
    // so it opens the catalogue, not a record of what was ordered before.
    case NotificationEvent.REORDER_REMINDER:
      return '/products';
    case NotificationEvent.CUSTOMER_REGISTERED:
      return '/';
    default:
      return INBOX;
  }
}
