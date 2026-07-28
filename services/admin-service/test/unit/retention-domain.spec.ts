import {
  DataClass,
  FINANCIAL_MIN_WINDOW_DAYS,
  isDataClass,
  isPurgeExempt,
  isPurgeable,
  purgeCutoff,
  rejectionReasonFor,
} from '../../src/domain/retention';

const NOW = new Date('2026-07-28T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('data classes (M23-21)', () => {
  it('exempts financial data from purging and nothing else', () => {
    expect(isPurgeExempt(DataClass.FINANCIAL)).toBe(true);
    for (const c of [DataClass.OPERATIONAL, DataClass.HR, DataClass.MARKETING]) {
      expect(isPurgeExempt(c)).toBe(false);
    }
  });

  it('recognises the four known classes and rejects anything else', () => {
    expect(isDataClass('FINANCIAL')).toBe(true);
    expect(isDataClass('HR')).toBe(true);
    expect(isDataClass('LEGAL')).toBe(false);
    expect(isDataClass(null)).toBe(false);
  });
});

describe('purgeCutoff', () => {
  it('never yields a cutoff for financial data, however short the window', () => {
    expect(purgeCutoff(DataClass.FINANCIAL, 1, NOW)).toBeNull();
    expect(purgeCutoff(DataClass.FINANCIAL, 3650, NOW)).toBeNull();
  });

  it('subtracts the window for a purgeable class', () => {
    expect(purgeCutoff(DataClass.MARKETING, 90, NOW)).toEqual(daysAgo(90));
  });

  it('treats a non-positive window as keep-everything, never delete-everything', () => {
    expect(purgeCutoff(DataClass.MARKETING, 0, NOW)).toBeNull();
    expect(purgeCutoff(DataClass.MARKETING, -5, NOW)).toBeNull();
  });
});

describe('isPurgeable', () => {
  it('deletes only records strictly older than the cutoff', () => {
    expect(isPurgeable(DataClass.MARKETING, 90, daysAgo(91), NOW)).toBe(true);
    expect(isPurgeable(DataClass.MARKETING, 90, daysAgo(90), NOW)).toBe(false);
    expect(isPurgeable(DataClass.MARKETING, 90, daysAgo(1), NOW)).toBe(false);
  });

  it('keeps a decade-old financial record (M23-21)', () => {
    expect(isPurgeable(DataClass.FINANCIAL, 3650, daysAgo(20 * 365), NOW)).toBe(false);
  });

  it('purges HR and operational data on their own windows', () => {
    expect(isPurgeable(DataClass.HR, 1825, daysAgo(1826), NOW)).toBe(true);
    expect(isPurgeable(DataClass.OPERATIONAL, 365, daysAgo(400), NOW)).toBe(true);
    expect(isPurgeable(DataClass.HR, 1825, daysAgo(400), NOW)).toBe(false);
  });
});

describe('rejectionReasonFor', () => {
  it('refuses to shorten financial retention below ten years', () => {
    expect(rejectionReasonFor(DataClass.FINANCIAL, FINANCIAL_MIN_WINDOW_DAYS - 1)).toContain(
      '3650',
    );
    expect(rejectionReasonFor(DataClass.FINANCIAL, FINANCIAL_MIN_WINDOW_DAYS)).toBeNull();
    expect(rejectionReasonFor(DataClass.FINANCIAL, 7300)).toBeNull();
  });

  it('allows any non-negative window for the other classes', () => {
    expect(rejectionReasonFor(DataClass.MARKETING, 30)).toBeNull();
    expect(rejectionReasonFor(DataClass.MARKETING, -1)).toContain('negatif');
  });
});
