import { describe, expect, it } from 'vitest';

import {
  isCancellable,
  nextStatus,
  staffCanAdvance,
  statusLabel,
  statusProgress,
  tone,
} from '@/lib/order-status';

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

  it('gives the next status in the flow, null at the end', () => {
    expect(nextStatus('CREATED')).toBe('CONFIRMED');
    expect(nextStatus('ON_DELIVERY')).toBe('DELIVERED');
    expect(nextStatus('COMPLETED')).toBeNull();
    expect(nextStatus('CANCELLED')).toBeNull();
  });

  it('lets staff advance only the depot prep steps', () => {
    expect(staffCanAdvance('CREATED')).toBe(true);
    expect(staffCanAdvance('CONFIRMED')).toBe(true);
    // Driver assignment onward is owned by delivery-service.
    expect(staffCanAdvance('PREPARING')).toBe(false);
    expect(staffCanAdvance('ON_DELIVERY')).toBe(false);
  });
});
