import type { Customer, Order } from './types';
import { formatAddress } from './format';

/**
 * What a console sends when it hands an order to a courier.
 *
 * One copy for both consoles: the order queue and the order panel each built this by hand,
 * and the queue's copy had lost `customerId`, so its dispatches never reached the
 * customer's in-app feed.
 *
 * No `codAmount`: delivery-service reads the payment itself and ignores whatever a client
 * sends (two of the roles allowed to dispatch cannot read payments).
 */
export function assignBody(
  order: Order,
  driverId: string,
  driver: Pick<Customer, 'fullName' | 'phone'> | undefined,
) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    driverId,
    driverName: driver?.fullName || undefined,
    driverPhone: driver?.phone || undefined,
    depotId: order.depotId ?? undefined,
    // Same text the self-claim path builds, so a courier reads one format however the
    // order reached them (and an order with no city does not end in ", ").
    destinationAddress: formatAddress(order),
    destinationLat: order.latitude ?? undefined,
    destinationLng: order.longitude ?? undefined,
    recipientPhone: order.phone,
    customerId: order.customerId,
    items: order.items.map((i) => ({ name: i.productName, qty: i.quantity })),
    // The landmark and the window the customer chose, snapshotted so the courier's screen
    // never needs a second service to answer a question about the box in their hand.
    notes: order.notes ?? undefined,
    deliveryWindow: order.deliveryWindow ?? undefined,
  };
}
