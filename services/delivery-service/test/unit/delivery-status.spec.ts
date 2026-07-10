import {
  DeliveryStatus,
  canTransition,
  isActive,
  orderStatusFor,
} from '../../src/domain/delivery-status';

describe('DeliveryStatus state machine', () => {
  it('walks the happy path assigned → delivered', () => {
    const path = [
      DeliveryStatus.ASSIGNED,
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.ON_DELIVERY,
      DeliveryStatus.DELIVERED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows FAILED from any active state but not from terminal states', () => {
    expect(canTransition(DeliveryStatus.ASSIGNED, DeliveryStatus.FAILED)).toBe(true);
    expect(canTransition(DeliveryStatus.ON_DELIVERY, DeliveryStatus.FAILED)).toBe(true);
    expect(canTransition(DeliveryStatus.DELIVERED, DeliveryStatus.FAILED)).toBe(false);
    expect(canTransition(DeliveryStatus.FAILED, DeliveryStatus.ASSIGNED)).toBe(false);
  });

  it('rejects skipping steps or going backward', () => {
    expect(canTransition(DeliveryStatus.ASSIGNED, DeliveryStatus.ON_DELIVERY)).toBe(false);
    expect(canTransition(DeliveryStatus.ON_DELIVERY, DeliveryStatus.PICKED_UP)).toBe(false);
  });

  it('marks active states as driver-occupying', () => {
    expect(isActive(DeliveryStatus.ASSIGNED)).toBe(true);
    expect(isActive(DeliveryStatus.PICKED_UP)).toBe(true);
    expect(isActive(DeliveryStatus.ON_DELIVERY)).toBe(true);
    expect(isActive(DeliveryStatus.DELIVERED)).toBe(false);
    expect(isActive(DeliveryStatus.FAILED)).toBe(false);
  });

  it('maps delivery statuses to their order fulfilment status', () => {
    expect(orderStatusFor(DeliveryStatus.ASSIGNED)).toBe('DRIVER_ASSIGNED');
    expect(orderStatusFor(DeliveryStatus.PICKED_UP)).toBe('PICKED_UP');
    expect(orderStatusFor(DeliveryStatus.ON_DELIVERY)).toBe('ON_DELIVERY');
    expect(orderStatusFor(DeliveryStatus.DELIVERED)).toBe('DELIVERED');
    expect(orderStatusFor(DeliveryStatus.FAILED)).toBeNull();
  });
});
