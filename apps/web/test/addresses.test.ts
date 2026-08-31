import { describe, expect, it } from 'vitest';

import {
  EMPTY_ADDRESS_FORM,
  addressToBookForm,
  addressToForm,
  pickDefaultAddress,
  toAddressPayload,
} from '@/lib/addresses';
import type { Address } from '@/lib/types';

/** The key is what the test asserts: it names the rejection more precisely than copy. */
const t = (key: string) => key;

const make = (over: Partial<Address> & { id: string }): Address => ({
  label: 'Rumah',
  recipientName: 'Budi',
  phone: '0812',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  postalCode: '40111',
  latitude: -6.9,
  longitude: 107.6,
  notes: null,
  isPrimary: false,
  ...over,
});

describe('pickDefaultAddress', () => {
  it('returns null when there are no addresses', () => {
    expect(pickDefaultAddress([])).toBeNull();
  });

  it('prefers the primary address over the first', () => {
    const a = make({ id: '1' });
    const b = make({ id: '2', isPrimary: true });
    expect(pickDefaultAddress([a, b])?.id).toBe('2');
  });

  it('falls back to the first address when none is primary', () => {
    expect(pickDefaultAddress([make({ id: '1' }), make({ id: '2' })])?.id).toBe('1');
  });
});

describe('addressToForm', () => {
  it('maps stored fields and blanks per-order notes', () => {
    const form = addressToForm(make({ id: '1', postalCode: null }));
    expect(form).toMatchObject({ recipientName: 'Budi', city: 'Bandung', notes: '' });
    // Province and postcode left the form; the columns stay in the database for the
    // addresses already written, so the mapper must not resurrect them as empty strings.
    expect(form).not.toHaveProperty('province');
    expect(form).not.toHaveProperty('postalCode');
  });
});

describe('toAddressPayload', () => {
  const base = {
    ...EMPTY_ADDRESS_FORM,
    label: 'Rumah',
    recipientName: 'Budi',
    phone: '0812',
    addressLine: 'Jl. Merdeka 10',
    city: 'Bandung',
    province: 'Jawa Barat',
  };

  // E6: this used to assert the message named the field — `city is required.` — which
  // was the field's code name, in English, on a customer's screen. It now names the
  // dictionary key instead; the "which field" test moved to the form, which marks them.
  it('rejects a missing required field', () => {
    const r = toAddressPayload({ ...base, city: '  ' }, t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('errors.address.required');
  });

  // The pin is required now (UAT-M2-06): depot routing is by distance, so an address
  // with no coordinates cannot be matched to a depot at all.
  it('rejects a blank pin, and sends no province the form never asked for', () => {
    expect(toAddressPayload(base, t).ok).toBe(false);
    const r = toAddressPayload({ ...base, latitude: '-6.9147', longitude: '107.6098' }, t);
    expect(r).toEqual({
      ok: true,
      value: {
        label: 'Rumah',
        recipientName: 'Budi',
        phone: '0812',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
        latitude: -6.9147,
        longitude: 107.6098,
      },
    });
  });

  it('parses coords when both are provided and in range', () => {
    const r = toAddressPayload({ ...base, latitude: '-6.9', longitude: '107.6' }, t);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ latitude: -6.9, longitude: 107.6 });
    // The payload must not carry a province the form no longer asks for.
    if (r.ok) expect(r.value).not.toHaveProperty('province');
  });

  it('rejects a half-filled pin', () => {
    const r = toAddressPayload({ ...base, latitude: '-6.9' }, t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pinRequired/);
  });

  it('rejects an out-of-range latitude', () => {
    const r = toAddressPayload({ ...base, latitude: '99', longitude: '107.6' }, t);
    expect(r.ok).toBe(false);
  });
});

describe('addressToBookForm', () => {
  it('stringifies coords and blanks nulls', () => {
    const form = addressToBookForm(
      make({ id: '1', latitude: -6.9, longitude: null, postalCode: null }),
    );
    expect(form).toMatchObject({ label: 'Rumah', latitude: '-6.9', longitude: '' });
    expect(form).not.toHaveProperty('postalCode');
    expect(form).not.toHaveProperty('province');
  });
});

// E6: three of the five refusals in `toAddressPayload` were English literals written for
// a developer — "label is required.", "Latitude must be between -90 and 90." — shown
// unaltered to a customer saving an address under `lang="id"`.
describe('E6 · address validation speaks the customer’s language', () => {
  const form = {
    label: 'Rumah',
    recipientName: 'Budi',
    phone: '0812',
    addressLine: 'Jl. Merdeka 10',
    city: 'Bandung',
    province: 'Jawa Barat',
    postalCode: '',
    notes: '',
    latitude: '-6.9',
    longitude: '107.6',
  };

  it('names the missing field through the dictionary, not through its code name', () => {
    const out = toAddressPayload({ ...form, recipientName: '  ' }, t);
    expect(out).toMatchObject({ ok: false, error: 'errors.address.required' });
  });

  it('rejects an out-of-range latitude through the dictionary', () => {
    const out = toAddressPayload({ ...form, latitude: '99' }, t);
    expect(out).toMatchObject({ ok: false, error: 'errors.address.latitudeRange' });
  });

  it('rejects an out-of-range longitude through the dictionary', () => {
    const out = toAddressPayload({ ...form, longitude: '-999' }, t);
    expect(out).toMatchObject({ ok: false, error: 'errors.address.longitudeRange' });
  });
});
