import { describe, expect, it } from 'vitest';

import { defaultDepotFromLocation, EMPTY_DEPOT_FORM, resolveDeliveryDepot, servingDepot, toDepotPayload } from '@/lib/depots';
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
    expect(res).toEqual({ ok: false, error: 'opsFix.depotForm.fieldRequired' });
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

  const row = (ownerId: string, sharePct: string, isPrimary = false) => ({ ownerId, sharePct, isPrimary });
  const franchise = (owners: ReturnType<typeof row>[]) =>
    toDepotPayload({ ...valid, ownershipType: 'WARALABA', owners }, t);

  it('rejects a franchise depot with no owner', () => {
    expect(franchise([])).toEqual({ ok: false, error: 'opsFix.depotForm.ownerRequired' });
    // The untouched blank row of a fresh form is no owner either.
    expect(franchise([row('  ', '100', true)]).ok).toBe(false);
    expect(toDepotPayload({ ...valid, ownershipType: 'WARALABA' }, t).ok).toBe(false);
  });

  it('sends the owners for a franchise depot and clears them for a company one', () => {
    const one = franchise([row('owner-9', '', false)]);
    // A lone owner takes everything and is the primary, whatever the row says.
    expect(one.ok && one.value.owners).toEqual([{ ownerId: 'owner-9', sharePct: 100, isPrimary: true }]);
    expect(one.ok && one.value.ownerId).toBe('owner-9');
    // Owner picked, then the type flipped back to HKP: the stale owners must not be sent.
    const central = toDepotPayload({ ...valid, owners: [row('owner-9', '100', true)] }, t);
    expect(central.ok && central.value.ownerId).toBeNull();
    expect(central.ok && central.value.owners).toEqual([]);
  });

  it('sends several owners with their shares and the primary as ownerId', () => {
    const out = franchise([row('a', '60', true), row('b', '40')]);
    expect(out.ok && out.value.owners).toEqual([
      { ownerId: 'a', sharePct: 60, isPrimary: true },
      { ownerId: 'b', sharePct: 40, isPrimary: false },
    ]);
    expect(out.ok && out.value.ownerId).toBe('a');
    // A three-way split only adds up in hundredths.
    expect(franchise([row('a', '33.34', true), row('b', '33.33'), row('c', '33.33')]).ok).toBe(true);
  });

  it.each([
    ['shares that do not add up', [row('a', '60', true), row('b', '30')], 'opsFix.depotForm.ownersTotal'],
    ['a blank share', [row('a', '60', true), row('b', '')], 'opsFix.depotForm.ownersShare'],
    ['a zero share', [row('a', '100', true), row('b', '0')], 'opsFix.depotForm.ownersShare'],
    ['a share over 100', [row('a', '101', true), row('b', '-1')], 'opsFix.depotForm.ownersShare'],
    ['three decimals', [row('a', '60.005', true), row('b', '39.995')], 'opsFix.depotForm.ownersShare'],
    ['no primary', [row('a', '50'), row('b', '50')], 'opsFix.depotForm.ownersPrimary'],
    ['two primaries', [row('a', '50', true), row('b', '50', true)], 'opsFix.depotForm.ownersPrimary'],
    ['an owner twice', [row('a', '50', true), row('a', '50')], 'opsFix.depotForm.ownersDuplicate'],
  ])('rejects %s', (_name, owners, error) => {
    expect(franchise(owners)).toEqual({ ok: false, error });
  });
});
