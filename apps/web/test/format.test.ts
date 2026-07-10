import { describe, expect, it } from 'vitest';

import { formatIDR, normalizePhone } from '@/lib/format';

describe('formatIDR', () => {
  it('formats whole rupiah with a thousands separator and a space', () => {
    expect(formatIDR(20000)).toBe('Rp 20.000');
    expect(formatIDR(0)).toBe('Rp 0');
    expect(formatIDR(1500000)).toBe('Rp 1.500.000');
  });

  it('does not render fractional digits', () => {
    expect(formatIDR(19999.5)).toBe('Rp 20.000');
  });
});

describe('normalizePhone', () => {
  it('keeps local (0-prefixed) and E.164 (+62) forms intact', () => {
    expect(normalizePhone('081234567890')).toBe('081234567890');
    expect(normalizePhone('+6281234567890')).toBe('+6281234567890');
  });

  it('adds a + to a bare 62 country code and strips spaces/dashes', () => {
    expect(normalizePhone('62 812-3456-7890')).toBe('+6281234567890');
  });
});
