import { describe, expect, it } from 'vitest';

import { EMPTY_DEPOT_FORM, toDepotPayload } from '@/lib/depots';

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
});
