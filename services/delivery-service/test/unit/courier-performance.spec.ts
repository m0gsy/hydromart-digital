import { dayIndex, previousWeek, weekWindow } from '../../src/domain/courier-performance';

describe('courier-performance windows', () => {
  it('bounds the WIB week starting at 00:00 Jakarta', () => {
    const w = weekWindow('2026-07-13');
    // 00:00 WIB on 13 Jul = 17:00 UTC on 12 Jul.
    expect(w.from.toISOString()).toBe('2026-07-12T17:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-07-19T17:00:00.000Z');
  });

  it('previousWeek shifts the window back exactly 7 days', () => {
    const p = previousWeek(weekWindow('2026-07-13'));
    expect(p.from.toISOString()).toBe('2026-07-05T17:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-07-12T17:00:00.000Z');
  });

  it('buckets by WIB calendar day — 23:30 WIB stays on its own day', () => {
    const { from } = weekWindow('2026-07-13');
    // Mon 13 Jul 23:30 WIB = 16:30 UTC — day 0, not the UTC-next day.
    expect(dayIndex(new Date('2026-07-13T16:30:00Z'), from)).toBe(0);
    // Wed 15 Jul 08:00 WIB = 01:00 UTC — day 2.
    expect(dayIndex(new Date('2026-07-15T01:00:00Z'), from)).toBe(2);
    // Sun (last day) clamps at 6.
    expect(dayIndex(new Date('2026-07-19T10:00:00Z'), from)).toBe(6);
  });

  it('rejects a malformed weekStart', () => {
    expect(() => weekWindow('not-a-date')).toThrow();
  });
});
