import { describe, expect, it } from 'vitest';

import { EMPTY_DEPOT_FORM, resolveDeliveryDepot, toDepotPayload } from '@/lib/depots';
import type { Depot, NearbyDepot } from '@/lib/types';

/** The key is what the test asserts: it names the rejection more precisely than copy. */
const t = (key: string) => key;

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

describe('toDepotPayload — depot WhatsApp number (SOP §3)', () => {
  const withPhone = (contactPhone: string) => toDepotPayload({ ...valid, contactPhone }, t);

  it('accepts a plain or +-prefixed number', () => {
    expect(withPhone('081234567890')).toMatchObject({
      ok: true,
      value: { contactPhone: '081234567890' },
    });
    expect(withPhone('+6281234567890')).toMatchObject({ ok: true });
  });

  it('sends null when left blank — the depot falls back to the ops number', () => {
    expect(toDepotPayload(valid, t)).toMatchObject({ ok: true, value: { contactPhone: null } });
  });

  // crm-service enforces exactly this pattern and the send path is fail-open, so a dashed
  // number saved here would mean the depot silently never gets its report at 13:00.
  it('refuses a number crm-service would reject, at the form rather than at send time', () => {
    for (const bad of ['0812-3456-7890', '+62 812 3456 7890', '0812', 'telp depot']) {
      expect(withPhone(bad)).toMatchObject({ ok: false });
    }
  });
});

describe('toDepotPayload', () => {
  it('coerces a valid form to a numeric payload', () => {
    const res = toDepotPayload(valid, t);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toMatchObject({ code: 'JKT-01', lat: -6.19, lng: 106.84, deliveryFee: 5000, minOrderAmount: null });
      expect('serviceRadiusKm' in res.value).toBe(false);
    }
  });

  it('rejects a missing required field', () => {
    const res = toDepotPayload({ ...valid, name: '  ' }, t);
    expect(res).toEqual({ ok: false, error: 'name is required.' });
  });

  it('rejects out-of-range coordinates and negative fee', () => {
    expect(toDepotPayload({ ...valid, lat: '99' }, t).ok).toBe(false);
    expect(toDepotPayload({ ...valid, lng: '999' }, t).ok).toBe(false);
    expect(toDepotPayload({ ...valid, deliveryFee: '-1' }, t).ok).toBe(false);
  });

  it('includes serviceRadiusKm and minOrderAmount when provided', () => {
    const res = toDepotPayload({ ...valid, serviceRadiusKm: '8', minOrderAmount: '20000' }, t);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ serviceRadiusKm: 8, minOrderAmount: 20000 });
  });

  it('rejects a non-positive service radius', () => {
    expect(toDepotPayload({ ...valid, serviceRadiusKm: '0' }, t).ok).toBe(false);
  });

  it('rejects a franchise depot with no owner', () => {
    expect(toDepotPayload({ ...valid, ownershipType: 'WARALABA' }, t)).toEqual({
      ok: false,
      error: 'opsFix.depotForm.ownerRequired',
    });
    expect(toDepotPayload({ ...valid, ownershipType: 'WARALABA', ownerId: '  ' }, t).ok).toBe(false);
  });

  it('sends the owner for a franchise depot and clears it for a company one', () => {
    const franchise = toDepotPayload({ ...valid, ownershipType: 'WARALABA', ownerId: 'owner-9' }, t);
    expect(franchise.ok && franchise.value.ownerId).toBe('owner-9');
    // Owner picked, then the type flipped back to HKP: the stale owner must not be sent.
    const central = toDepotPayload({ ...valid, ownerId: 'owner-9' }, t);
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
