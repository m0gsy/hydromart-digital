import { denseDailySeries } from '../../src/domain/series';

// Covers the out-of-window `continue` branch (rows before fromDay / after toDay are dropped).
describe('denseDailySeries out-of-window rows', () => {
  it('skips rows outside [fromDay, toDay] and keeps in-window ones', () => {
    const rows = [
      { day: 98, quantity: 99 }, // before window -> i < 0, skipped
      { day: 101, quantity: 5 }, // in window
      { day: 105, quantity: 77 }, // after window -> i >= length, skipped
    ];
    expect(denseDailySeries(rows, { fromDay: 100, toDay: 102 })).toEqual([0, 5, 0]);
  });
});
