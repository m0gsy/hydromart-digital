import { describe, expect, it } from 'vitest';

import {
  EMPTY_ADDRESS_FORM,
  addressToBookForm,
  addressToForm,
  pickDefaultAddress,
  toAddressPayload,
} from '@/lib/addresses';
import type { Address } from '@/lib/types';

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
    expect(form).toMatchObject({ recipientName: 'Budi', city: 'Bandung', postalCode: '', notes: '' });
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

  it('rejects a missing required field', () => {
    const r = toAddressPayload({ ...base, city: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/city/);
  });

  it('omits blank coords and postal code', () => {
    const r = toAddressPayload(base);
    expect(r).toEqual({
      ok: true,
      value: {
        label: 'Rumah',
        recipientName: 'Budi',
        phone: '0812',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
        province: 'Jawa Barat',
      },
    });
  });

  it('parses coords when both are provided and in range', () => {
    const r = toAddressPayload({ ...base, latitude: '-6.9', longitude: '107.6', postalCode: '40111' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ latitude: -6.9, longitude: 107.6, postalCode: '40111' });
  });

  it('requires latitude and longitude together', () => {
    const r = toAddressPayload({ ...base, latitude: '-6.9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/both/);
  });

  it('rejects an out-of-range latitude', () => {
    const r = toAddressPayload({ ...base, latitude: '99', longitude: '107.6' });
    expect(r.ok).toBe(false);
  });
});

describe('addressToBookForm', () => {
  it('stringifies coords and blanks nulls', () => {
    expect(addressToBookForm(make({ id: '1', latitude: -6.9, longitude: null, postalCode: null }))).toMatchObject(
      { label: 'Rumah', latitude: '-6.9', longitude: '', postalCode: '' },
    );
  });
});
