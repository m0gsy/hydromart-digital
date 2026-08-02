import { describe, expect, it } from 'vitest';

import { EMPTY_DEPOT_FORM, resolveDeliveryDepot, toDepotPayload } from '@/lib/depots';
import type { Depot, NearbyDepot } from '@/lib/types';

const valid = {
  ...EMPTY_DEPOT_FORM,
  code: 'JKT-01',
  name: 'Depot Cikini',
  address: 'Jl. Cikini 1',
  city: 'Jakarta',
  province: 'DKI',
  lat: '-6.19',
  lng: '106.84',
  deliveryFee: '5000',
};

describe('toDepotPayload', () => {
  it('coerces a valid form to a numeric payload', () => {
    const res = toDepotPayload(valid);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toMatchObject({ code: 'JKT-01', lat: -6.19, lng: 106.84, deliveryFee: 5000, minOrderAmount: null });
      expect('serviceRadiusKm' in res.value).toBe(false);
    }
  });

  it('rejects a missing required field', () => {
    const res = toDepotPayload({ ...valid, name: '  ' });
    expect(res).toEqual({ ok: false, error: 'name is required.' });
  });

  it('rejects out-of-range coordinates and negative fee', () => {
    expect(toDepotPayload({ ...valid, lat: '99' }).ok).toBe(false);
    expect(toDepotPayload({ ...valid, lng: '999' }).ok).toBe(false);
    expect(toDepotPayload({ ...valid, deliveryFee: '-1' }).ok).toBe(false);
  });

  it('includes serviceRadiusKm and minOrderAmount when provided', () => {
    const res = toDepotPayload({ ...valid, serviceRadiusKm: '8', minOrderAmount: '20000' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ serviceRadiusKm: 8, minOrderAmount: 20000 });
  });

  it('rejects a non-positive service radius', () => {
    expect(toDepotPayload({ ...valid, serviceRadiusKm: '0' }).ok).toBe(false);
  });

  it('rejects a franchise depot with no owner', () => {
    expect(toDepotPayload({ ...valid, ownershipType: 'WARALABA' })).toEqual({
      ok: false,
      error: 'A franchise depot must have an owner.',
    });
    expect(toDepotPayload({ ...valid, ownershipType: 'WARALABA', ownerId: '  ' }).ok).toBe(false);
  });

  it('sends the owner for a franchise depot and clears it for a company one', () => {
    const franchise = toDepotPayload({ ...valid, ownershipType: 'WARALABA', ownerId: 'owner-9' });
    expect(franchise.ok && franchise.value.ownerId).toBe('owner-9');
    // Owner picked, then the type flipped back to HKP: the stale owner must not be sent.
    const central = toDepotPayload({ ...valid, ownerId: 'owner-9' });
    expect(central.ok && central.value.ownerId).toBeNull();
  });
});

describe('resolveDeliveryDepot', () => {
  const picked = { id: 'd2', code: 'JKT-02', name: 'Depot Menteng', city: 'Jakarta', deliveryFee: 7000 } as Depot;
  const near = { id: 'd1', name: 'Depot Cikini', deliveryFee: 5000 } as NearbyDepot;

  it('quotes the hand-picked depot when the address has no pin', () => {
    expect(resolveDeliveryDepot(true, 'd2', [picked], [])).toBe(picked);
  });

  it('quotes the routed depot when the address has a pin', () => {
    expect(resolveDeliveryDepot(false, null, null, [near])).toBe(near);
  });

  it('returns null while no depot is picked yet, or none is nearby', () => {
    expect(resolveDeliveryDepot(true, null, [picked], [])).toBeNull();
    expect(resolveDeliveryDepot(true, 'd9', [picked], [])).toBeNull();
    expect(resolveDeliveryDepot(false, null, null, [])).toBeNull();
    expect(resolveDeliveryDepot(false, null, null, undefined)).toBeNull();
  });
});
