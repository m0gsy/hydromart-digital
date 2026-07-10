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
    expect(canTransition(OrderStatus.PICKED_UP, OrderStatus.PREPARING)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.CREATED)).toBe(false);
  });

  it('allows cancel only before a driver is assigned (BR-006)', () => {
    expect(isCancellable(OrderStatus.CREATED)).toBe(true);
    expect(isCancellable(OrderStatus.CONFIRMED)).toBe(true);
    expect(isCancellable(OrderStatus.PREPARING)).toBe(true);
    expect(isCancellable(OrderStatus.DRIVER_ASSIGNED)).toBe(false);
    expect(isCancellable(OrderStatus.PICKED_UP)).toBe(false);
    expect(canTransition(OrderStatus.DRIVER_ASSIGNED, OrderStatus.CANCELLED)).toBe(false);
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
