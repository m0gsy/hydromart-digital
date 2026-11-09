/*
 * F9. "Pesanan masuk" on the operator's "today" screen was the length of the last 100 orders, with
 * no date at all: on a quiet day it counted last week's. It counts the orders placed today in
 * Jakarta; the "needs a courier" list is NOT narrowed by date (an unassigned order from last
 * night still needs one).
 */
import { describe, expect, it } from 'vitest';

import { placedToday } from '@/components/operator/operator-ringkasan';

describe('F9 the operator summary counts today only', () => {
  const at = new Date('2026-11-09T05:00:00.000Z'); // 12:00 WIB on the 9th

  it('keeps orders placed today in Jakarta and drops the rest', () => {
    const orders = [
      { createdAt: '2026-11-09T01:00:00.000Z' }, // 08:00 WIB, today
      { createdAt: '2026-11-08T20:00:00.000Z' }, // 03:00 WIB on the 9th - today in Jakarta
      { createdAt: '2026-11-08T10:00:00.000Z' }, // 17:00 WIB on the 8th - yesterday
      { createdAt: '2026-11-02T10:00:00.000Z' },
    ];
    expect(placedToday(orders, at)).toHaveLength(2);
  });

  it('an empty list stays empty', () => {
    expect(placedToday([], at)).toEqual([]);
  });
});
