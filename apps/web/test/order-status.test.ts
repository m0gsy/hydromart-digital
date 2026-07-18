import { describe, expect, it } from 'vitest';

import {
  ORDER_FLOW,
  isCancellable,
  nextStatus,
  staffCanAdvance,
  statusLabel,
  statusProgress,
  tone,
} from '@/lib/order-status';
import type { OrderStatus } from '@/lib/types';

describe('order-status', () => {
  it('labels every status including terminal CANCELLED', () => {
    for (const s of [...ORDER_FLOW, 'CANCELLED' as OrderStatus]) {
      expect(statusLabel(s)).toBeTruthy();
    }
  });

  describe('statusProgress', () => {
    it('advances monotonically 0..1 across the flow', () => {
      const progress = ORDER_FLOW.map(statusProgress);
      for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1]);
      expect(statusProgress('COMPLETED')).toBe(1);
    });
    it('is 0 for the off-track CANCELLED state', () => {
      expect(statusProgress('CANCELLED')).toBe(0);
    });
  });

  describe('isCancellable (BR-006: only before a driver is assigned)', () => {
    it('allows cancel up to and including PREPARING', () => {
      expect(['CREATED', 'CONFIRMED', 'PREPARING'].every(isCancellable as (s: string) => boolean)).toBe(true);
    });
    it('forbids cancel once a driver is assigned or later', () => {
      expect(
        ['DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'].some(
          isCancellable as (s: string) => boolean,
        ),
      ).toBe(false);
    });
  });

  describe('nextStatus', () => {
    it('walks the flow in order', () => {
      expect(nextStatus('CREATED')).toBe('CONFIRMED');
      expect(nextStatus('DELIVERED')).toBe('COMPLETED');
    });
    it('is null at the end and for CANCELLED', () => {
      expect(nextStatus('COMPLETED')).toBeNull();
      expect(nextStatus('CANCELLED')).toBeNull();
    });
  });

  describe('staffCanAdvance (only depot prep steps are staff-driven)', () => {
    it('is true only for CREATED/CONFIRMED', () => {
      expect(staffCanAdvance('CREATED')).toBe(true);
      expect(staffCanAdvance('CONFIRMED')).toBe(true);
      expect(staffCanAdvance('PREPARING')).toBe(false);
      expect(staffCanAdvance('DRIVER_ASSIGNED')).toBe(false);
    });
  });

  describe('tone', () => {
    it('maps to active/done/cancelled buckets', () => {
      expect(tone('CREATED')).toBe('active');
      expect(tone('DELIVERED')).toBe('done');
      expect(tone('COMPLETED')).toBe('done');
      expect(tone('CANCELLED')).toBe('cancelled');
    });
  });
});
