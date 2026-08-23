import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { destinationFor, storedDestinationFor } from '../../src/domain/notification-destination';
import { NotificationEvent } from '../../src/domain/notification-event';
import { PushPayload } from '../../src/application/ports/push-sender.port';
import { InMemoryNotificationRepository } from '../support/fakes';

describe('destinationFor', () => {
  const ORDER_EVENTS = [
    NotificationEvent.ORDER_RECEIVED,
    NotificationEvent.ORDER_CONFIRMED,
    NotificationEvent.ORDER_ON_DELIVERY,
    NotificationEvent.ORDER_DELIVERED,
    NotificationEvent.ORDER_COMPLETED,
    NotificationEvent.ORDER_CANCELLED,
  ];

  it.each(ORDER_EVENTS)('%s opens that order in the query-param route', (event) => {
    expect(destinationFor(event, { orderId: 'ord-1' })).toBe('/orders/detail?id=ord-1');
  });

  it('escapes the id rather than trusting it to be url-safe', () => {
    expect(destinationFor(NotificationEvent.ORDER_RECEIVED, { orderId: 'a b&c' })).toBe(
      '/orders/detail?id=a%20b%26c',
    );
  });

  it('falls back to the order list when the emitter sent no id', () => {
    expect(destinationFor(NotificationEvent.ORDER_DELIVERED, { name: 'Budi' })).toBe('/orders');
  });

  it.each([
    [NotificationEvent.POINTS_EARNED, '/rewards'],
    [NotificationEvent.VOUCHER_GRANTED, '/vouchers'],
    [NotificationEvent.REORDER_REMINDER, '/products'],
    [NotificationEvent.CUSTOMER_REGISTERED, '/'],
  ])('%s opens %s', (event, url) => {
    expect(destinationFor(event, {})).toBe(url);
  });

  it('leaves staff-facing events on the inbox, which is where they are never pushed from', () => {
    expect(destinationFor(NotificationEvent.STOCK_LOW, {})).toBe('/notifications');
    expect(destinationFor(NotificationEvent.HR_ANNOUNCEMENT)).toBe('/notifications');
  });
});

describe('NotificationService push destination', () => {
  it('sends the per-event destination, not the inbox for everything', async () => {
    const payloads: PushPayload[] = [];
    const push = {
      sendToCustomer: async (_id: string, payload: PushPayload) => {
        payloads.push(payload);
      },
    } as unknown as PushService;
    const service = new NotificationService(new InMemoryNotificationRepository(), push);

    await service.notify(
      NotificationEvent.ORDER_ON_DELIVERY,
      '+62800',
      { name: 'Budi', orderNumber: 'HM-1', orderId: 'ord-9' },
      'cust-1',
    );
    // The push is fire-and-forget inside notify(); let the microtask queue drain.
    await Promise.resolve();

    expect(payloads[0]?.url).toBe('/orders/detail?id=ord-9');
    // The id is a routing hint, never copy — no template names it.
    expect(payloads[0]?.body).not.toContain('ord-9');
  });
});

/*
 * O1 — what gets STORED is not what a push gets. A push always needs a landing screen, so
 * the fallback is the inbox; a row already inside that inbox must not link to itself.
 */
describe('storedDestinationFor', () => {
  it('keeps a real screen', () => {
    expect(storedDestinationFor(NotificationEvent.POINTS_EARNED)).toBe('/rewards');
    expect(storedDestinationFor(NotificationEvent.ORDER_CONFIRMED, { orderId: 'o-1' })).toBe(
      '/orders/detail?id=o-1',
    );
  });

  it('is null where the push would fall back to the inbox itself', () => {
    expect(storedDestinationFor(NotificationEvent.STOCK_LOW, {})).toBeNull();
    // Called with no vars at all — the ops emitters do exactly this.
    expect(storedDestinationFor(NotificationEvent.HR_ANNOUNCEMENT)).toBeNull();
  });
});
