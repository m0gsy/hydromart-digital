import { describe, expect, it } from 'vitest';

import { peakCell, peakIndex } from '@/lib/insight/peak';

const grid = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

describe('peakCell', () => {
  it('finds the weekday-hour with the most orders, the earliest on a tie', () => {
    const heat = grid();
    heat[2]![10] = 5;
    heat[4]![9] = 5;
    heat[0]![3] = 2;
    expect(peakCell(heat)).toEqual({ weekday: 2, hour: 10, orders: 5 });
  });

  it('has no peak when nothing was ordered, rather than reporting Monday midnight', () => {
    expect(peakCell(grid())).toBeNull();
    expect(peakCell([])).toBeNull();
  });
});

describe('peakIndex', () => {
  it('finds the largest value, the first on a tie, and none for all zeros', () => {
    expect(peakIndex([1, 4, 4, 2])).toBe(1);
    expect(peakIndex([0, 0, 0])).toBeNull();
    expect(peakIndex([])).toBeNull();
  });
});
