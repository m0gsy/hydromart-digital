import { describe, expect, it } from 'vitest';

import { effectiveDepotIdFor } from '@/app/dashboard/promo-rules/page';
import type { PromoRule } from '@/lib/types';

const rule = (overrides: Partial<PromoRule> = {}): PromoRule => ({
  id: 'rule-1',
  name: 'Test',
  kind: 'SPECIAL_PRICE',
  depotId: 'depot-b',
  productId: null,
  categoryId: null,
  specialPrice: 7000,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  validFrom: null,
  validUntil: null,
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('effectiveDepotIdFor', () => {
  it('defaults a NEW rule (rule is null) to the active depot', () => {
    expect(effectiveDepotIdFor(null, 'depot-a')).toBe('depot-a');
  });

  it('preserves an EXISTING rule\'s own depotId even when a different depot is active', () => {
    // The exact regression this guards: editing a depot-B rule while depot-A is the
    // console's active context must never silently move the rule to depot-A.
    expect(effectiveDepotIdFor(rule({ depotId: 'depot-b' }), 'depot-a')).toBe('depot-b');
  });

  it('preserves a network-wide rule (depotId: null) rather than substituting the active depot', () => {
    expect(effectiveDepotIdFor(rule({ depotId: null }), 'depot-a')).toBeNull();
  });
});
