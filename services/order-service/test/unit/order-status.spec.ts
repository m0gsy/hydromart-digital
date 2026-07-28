import {
  OrderStatus,
  canTransition,
  isCancellable,
  isEditable,
  nextStatuses,
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
});
