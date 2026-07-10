import { describe, expect, it } from 'vitest';

import { isCancellable, statusLabel, statusProgress, tone } from '@/lib/order-status';

describe('order status', () => {
  it('labels every status', () => {
    expect(statusLabel('ON_DELIVERY')).toBe('On the way');
    expect(statusLabel('CANCELLED')).toBe('Cancelled');
  });

  it('progresses monotonically through the fulfilment flow', () => {
    expect(statusProgress('CREATED')).toBeCloseTo(1 / 8);
    expect(statusProgress('COMPLETED')).toBe(1);
    expect(statusProgress('CANCELLED')).toBe(0);
  });

  it('allows cancellation only before a driver is assigned (BR-006)', () => {
    expect(isCancellable('CREATED')).toBe(true);
    expect(isCancellable('PREPARING')).toBe(true);
    expect(isCancellable('DRIVER_ASSIGNED')).toBe(false);
    expect(isCancellable('ON_DELIVERY')).toBe(false);
  });

  it('maps statuses to display tones', () => {
    expect(tone('CREATED')).toBe('active');
    expect(tone('DELIVERED')).toBe('done');
    expect(tone('CANCELLED')).toBe('cancelled');
  });
});
