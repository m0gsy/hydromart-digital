import {
  classifySegment,
  daysBetween,
  needsFollowUp,
  CrmThresholds,
} from '../../src/domain/crm-segment';

const T: CrmThresholds = { newDays: 30, activeDays: 30, followUpDays: 60 };
const NOW = new Date('2026-07-26T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('crm-segment', () => {
  it('daysBetween floors whole days', () => {
    expect(daysBetween(daysAgo(5), NOW)).toBe(5);
    expect(daysBetween(NOW, NOW)).toBe(0);
  });

  it('never-ordered → INACTIVE', () => {
    expect(classifySegment({ orderCount: 0, firstOrderAt: null, lastOrderAt: null }, NOW, T)).toBe('INACTIVE');
  });

  it('first order within newDays → BARU (wins over Aktif)', () => {
    expect(
      classifySegment({ orderCount: 2, firstOrderAt: daysAgo(10), lastOrderAt: daysAgo(2) }, NOW, T),
    ).toBe('BARU');
  });

  it('recent order but old first order → AKTIF', () => {
    expect(
      classifySegment({ orderCount: 5, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(10) }, NOW, T),
    ).toBe('AKTIF');
  });

  it('last order older than activeDays → INACTIVE', () => {
    expect(
      classifySegment({ orderCount: 5, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(45) }, NOW, T),
    ).toBe('INACTIVE');
  });

  it('needsFollowUp only past followUpDays', () => {
    expect(needsFollowUp({ orderCount: 1, firstOrderAt: daysAgo(70), lastOrderAt: daysAgo(70) }, NOW, T)).toBe(true);
    expect(needsFollowUp({ orderCount: 1, firstOrderAt: daysAgo(40), lastOrderAt: daysAgo(40) }, NOW, T)).toBe(false);
  });
});
