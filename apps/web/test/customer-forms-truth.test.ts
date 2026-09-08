import { describe, expect, it } from 'vitest';

import { toAddressPayload } from '@/lib/addresses';

/**
 * CA-3-52 — clearing the landmark never deleted it.
 *
 * The payload builder said `if (notes) value.notes = notes`, so emptying the box omitted
 * the key entirely — and a PATCH without a field leaves the stored column alone. A customer
 * who deleted a wrong or outdated patokan watched it disappear from the form while the
 * courier kept being sent to it. The field is the one a courier reads at the door, so a
 * stale one is worse than none.
 *
 * `null` is the difference between "no opinion" and "remove this", and only one of those
 * is what an emptied box means.
 */

const form = (over: Record<string, string> = {}) => ({
  label: 'Rumah',
  recipientName: 'Budi',
  phone: '0811',
  addressLine: 'Jl. Melati 1',
  city: 'Jakarta',
  latitude: '-6.2',
  longitude: '106.8',
  notes: '',
  ...over,
});

const t = (key: string) => key;

describe('CA-3-52 the address landmark', () => {
  it('sends null when the box is emptied, so the stored one is removed', () => {
    const result = toAddressPayload(form({ notes: '' }), t);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Present and null — not absent. Absent is what left the old value in place.
    expect('notes' in result.value).toBe(true);
    expect(result.value.notes).toBeNull();
  });

  it('sends whitespace-only as null too — a space is not a landmark', () => {
    const result = toAddressPayload(form({ notes: '   ' }), t);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes).toBeNull();
  });

  it('still carries a real landmark, trimmed', () => {
    const result = toAddressPayload(form({ notes: '  Depan masjid  ' }), t);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes).toBe('Depan masjid');
  });
});
