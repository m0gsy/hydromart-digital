import { dedupeKeyFor } from '../../src/infrastructure/http/notification.http.adapter';

describe('dedupeKeyFor', () => {
  it('keys the events that happen once per order by their order number', () => {
    for (const event of ['ORDER_RECEIVED', 'ORDER_CONFIRMED', 'ORDER_DELIVERED', 'ORDER_COMPLETED', 'ORDER_CANCELLED']) {
      expect(dedupeKeyFor(event, { orderNumber: 'HM-1' })).toBe(`${event}:HM-1`);
    }
  });

  it('never keys an event that can legitimately repeat, nor one without an order number', () => {
    expect(dedupeKeyFor('ORDER_ON_DELIVERY', { orderNumber: 'HM-1' })).toBeUndefined();
    expect(dedupeKeyFor('ORDER_DRIVER_ASSIGNED', { orderNumber: 'HM-1' })).toBeUndefined();
    expect(dedupeKeyFor('ORDER_RECEIVED', {})).toBeUndefined();
  });
});
