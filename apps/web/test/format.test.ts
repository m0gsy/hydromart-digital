import { describe, expect, it } from 'vitest';

import { formatIDR, normalizePhone, slugify } from '@/lib/format';

describe('slugify', () => {
  it('produces the shape product-service accepts', () => {
    expect(slugify('Air Minum')).toBe('air-minum');
    expect(slugify('  Galon 19L / Isi Ulang!  ')).toBe('galon-19l-isi-ulang');
    expect(slugify('Air—Minum')).toBe('air-minum'); // one hyphen per run, not two
  });

  it('returns empty for a name with nothing sluggable, so the caller must ask', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('formatIDR', () => {
  it('groups thousands with the id-ID dot separator and Rp prefix', () => {
    expect(formatIDR(20000)).toBe('Rp 20.000');
    expect(formatIDR(0)).toBe('Rp 0');
    expect(formatIDR(1234567)).toBe('Rp 1.234.567');
  });
});

describe('normalizePhone', () => {
  it('keeps an already-plus number intact', () => {
    expect(normalizePhone('+6281234567890')).toBe('+6281234567890');
  });
  it('keeps a local leading-zero number as-is', () => {
    expect(normalizePhone('081234567890')).toBe('081234567890');
  });
  it('prefixes a bare 62 number with +', () => {
    expect(normalizePhone('6281234567890')).toBe('+6281234567890');
  });
  it('strips spaces and dashes before deciding', () => {
    expect(normalizePhone('62 812-3456-7890')).toBe('+6281234567890');
  });
});
