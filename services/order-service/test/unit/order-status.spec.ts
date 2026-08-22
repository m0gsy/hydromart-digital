import {
  OrderStatus,
  canTransition,
  isCancellable,
  isEditable,
  isVoidableOn,
  nextStatuses,
  notificationEventFor,
} from '../../src/domain/order-status';

describe('OrderStatus state machine (BR-012, BR-005, BR-006)', () => {
  it('walks the full happy path forward', () => {
    const path = [
      OrderStatus.CREATED,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('rejects skipping a step or moving backward', () => {
    expect(canTransition(OrderStatus.CREATED, OrderStatus.PREPARING)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.CREATED)).toBe(false);
    expect(canTransition(OrderStatus.ON_DELIVERY, OrderStatus.CONFIRMED)).toBe(false);
  });

  it('lets an in-flight order fall back to PREPARING when its delivery is rescheduled (3c)', () => {
    // The one intentional backward move: a rescheduled delivery frees the courier and the
    // order returns to the dispatch queue. Without it the order stayed pinned to the
    // abandoned attempt and could never be assigned or delivered again.
    expect(canTransition(OrderStatus.DRIVER_ASSIGNED, OrderStatus.PREPARING)).toBe(true);
    expect(canTransition(OrderStatus.PICKED_UP, OrderStatus.PREPARING)).toBe(true);
    expect(canTransition(OrderStatus.ON_DELIVERY, OrderStatus.PREPARING)).toBe(true);
    // Terminal states stay terminal.
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.PREPARING)).toBe(false);
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PREPARING)).toBe(false);
  });

  it('allows cancel only before a driver is assigned (BR-006)', () => {
    expect(isCancellable(OrderStatus.CREATED)).toBe(true);
    expect(isCancellable(OrderStatus.CONFIRMED)).toBe(true);
    expect(isCancellable(OrderStatus.PREPARING)).toBe(true);
    expect(isCancellable(OrderStatus.DRIVER_ASSIGNED)).toBe(false);
    expect(isCancellable(OrderStatus.PICKED_UP)).toBe(false);
    expect(isCancellable(OrderStatus.ON_DELIVERY)).toBe(false);
    expect(isCancellable(OrderStatus.COMPLETED)).toBe(false);
  });

  it('still lets the SYSTEM cancel mid-delivery, unlike the customer', () => {
    // A delivery that fails on the road has to be able to close its order — otherwise the
    // order is stranded at ON_DELIVERY holding its stock reservation forever.
    for (const from of [
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_DELIVERY,
    ]) {
      expect(canTransition(from, OrderStatus.CANCELLED)).toBe(true);
      expect(isCancellable(from)).toBe(false);
    }
    // Terminal states stay terminal.
    expect(canTransition(OrderStatus.COMPLETED, OrderStatus.CANCELLED)).toBe(false);
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.CANCELLED)).toBe(false);
  });

  it('marks an order non-editable from pickup onward (BR-005)', () => {
    expect(isEditable(OrderStatus.PREPARING)).toBe(true);
    expect(isEditable(OrderStatus.DRIVER_ASSIGNED)).toBe(true);
    expect(isEditable(OrderStatus.PICKED_UP)).toBe(false);
    expect(isEditable(OrderStatus.ON_DELIVERY)).toBe(false);
    expect(isEditable(OrderStatus.CANCELLED)).toBe(false);
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    expect(nextStatuses(OrderStatus.COMPLETED)).toHaveLength(0);
    expect(nextStatuses(OrderStatus.CANCELLED)).toHaveLength(0);
  });

  describe('VOIDED', () => {
    // Not an edge out of COMPLETED on purpose: an edge would let ANY completed order be
    // voided, including a delivered one, which must go through the refund queue instead.
    it('is unreachable through the status graph, and terminal once written', () => {
      expect(canTransition(OrderStatus.COMPLETED, OrderStatus.VOIDED)).toBe(false);
      expect(canTransition(OrderStatus.DELIVERED, OrderStatus.VOIDED)).toBe(false);
      expect(nextStatuses(OrderStatus.VOIDED)).toHaveLength(0);
    });

    it('is not editable and sends no message — the buyer is standing right there', () => {
      expect(isEditable(OrderStatus.VOIDED)).toBe(false);
      expect(notificationEventFor(OrderStatus.VOIDED)).toBeNull();
    });
  });

  describe('isVoidableOn', () => {
    const TZ = 'Asia/Jakarta';

    it('allows a sale made earlier the same Jakarta day', () => {
      const sold = new Date('2026-08-03T01:00:00Z'); // 08:00 WIB
      const now = new Date('2026-08-03T09:00:00Z'); // 16:00 WIB
      expect(isVoidableOn(sold, now, TZ)).toBe(true);
    });

    // The trap this exists for: 21:00 and 09:00 next morning are four hours apart but belong
    // to two different drawers, and voiding backwards into a counted shift moves settled money.
    it('refuses a sale from the previous Jakarta day, hours apart though it is', () => {
      const sold = new Date('2026-08-03T14:00:00Z'); // 21:00 WIB, 3 Aug
      const now = new Date('2026-08-04T02:00:00Z'); // 09:00 WIB, 4 Aug
      expect(isVoidableOn(sold, now, TZ)).toBe(false);
    });

    // Late-evening WIB is already the next day in UTC. Judging by UTC would refuse a void
    // the cashier is entitled to make, minutes after the sale.
    it('judges the depot day, not UTC', () => {
      const sold = new Date('2026-08-03T16:30:00Z'); // 23:30 WIB, 3 Aug — 3 Aug in UTC
      const now = new Date('2026-08-03T16:50:00Z'); // 23:50 WIB, 3 Aug
      expect(isVoidableOn(sold, now, TZ)).toBe(true);
      // Twenty minutes later it is 4 Aug in Jakarta, and the drawer has turned over.
      expect(isVoidableOn(sold, new Date('2026-08-03T17:10:00Z'), TZ)).toBe(false);
    });
  });
});


/*
 * B6. Two holes on the same timeline, in opposite directions.
 *
 * DRIVER_ASSIGNED was silent — and that is the exact moment the customer's own right to
 * cancel ends (BR-006). The one transition where saying nothing costs them something.
 *
 * At the other end, proof of delivery marches the order through DELIVERED and then
 * COMPLETED in ONE loop (delivery.service.ts:285), so both fired seconds apart. Measured,
 * the customer got THREE messages at the door: "sudah sampai", "selesai — poin sudah
 * ditambahkan", and POINTS_EARNED with the actual number. Two of the three were about
 * points, and only one of those two knew how many.
 */
describe('B6 — the transitions that speak, and the one that repeats itself', () => {
  it('tells the customer when their own right to cancel has ended', () => {
    expect(notificationEventFor(OrderStatus.DRIVER_ASSIGNED)).toBe('ORDER_DRIVER_ASSIGNED');
  });

  it('stays silent on COMPLETED when DELIVERED just said it', () => {
    expect(notificationEventFor(OrderStatus.COMPLETED, OrderStatus.DELIVERED)).toBeNull();
  });

  it('still speaks on COMPLETED reached any other way', () => {
    expect(notificationEventFor(OrderStatus.COMPLETED, OrderStatus.ON_DELIVERY)).toBe(
      'ORDER_COMPLETED',
    );
    expect(notificationEventFor(OrderStatus.COMPLETED)).toBe('ORDER_COMPLETED');
  });

  it('leaves PREPARING and PICKED_UP silent, which they are right to be', () => {
    expect(notificationEventFor(OrderStatus.PREPARING)).toBeNull();
    expect(notificationEventFor(OrderStatus.PICKED_UP)).toBeNull();
  });
});
