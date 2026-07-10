import { describe, expect, it } from 'vitest';

import { addressToForm, pickDefaultAddress } from '@/lib/addresses';
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
