import { describe, expect, it } from 'vitest';

import { periodLabel } from '@/lib/insight/label';

describe('periodLabel', () => {
  it('reads a day, a month and a pass-through the way a person says them', () => {
    expect(periodLabel('2026-10-22', 'id')).toBe('22 Okt');
    expect(periodLabel('2026-10-05', 'id')).toBe('5 Okt');
    expect(periodLabel('2026-10', 'id')).toBe('Okt 2026');
    expect(periodLabel('2026-10-22', 'en')).toBe('22 Oct');
    // The forecast's own axis and anything else that is not a date stay as given.
    expect(periodLabel('+3', 'id')).toBe('+3');
    expect(periodLabel('-30', 'id')).toBe('-30');
    expect(periodLabel('', 'id')).toBe('');
  });

  it('does not invent a month for an impossible date', () => {
    expect(periodLabel('2026-13-01', 'id')).toBe('2026-13-01');
    expect(periodLabel('2026-00', 'id')).toBe('2026-00');
  });
});
