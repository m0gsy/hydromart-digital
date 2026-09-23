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

  /*
   * ADM-2. The floor was checked against the class the CALLER supplied, so one PUT could
   * reclassify a dataset out of FINANCIAL and shorten its window on the way past: ten years
   * of order history eligible for deletion, and every check in the file passed.
   */
  it('refuses to reclassify a financial dataset into something cheaper', () => {
    expect(rejectionReasonFor(DataClass.OPERATIONAL, 30, DataClass.FINANCIAL)).toContain(
      'tidak bisa diturunkan',
    );
    // Raising INTO financial is fine — that direction only ever keeps more.
    expect(rejectionReasonFor(DataClass.FINANCIAL, 3650, DataClass.OPERATIONAL)).toBeNull();
    expect(rejectionReasonFor(DataClass.FINANCIAL, 3650, DataClass.FINANCIAL)).toBeNull();
  });

  /*
   * ADM-2, the other half: an audit trail answers "who did this" for an investigation that
   * starts after somebody notices. A 7-day window does not make the company lighter, it
   * makes the next incident unreconstructable.
   */
  it('holds a floor under the audit trail whatever its class says', () => {
    expect(rejectionReasonFor(DataClass.OPERATIONAL, 7, undefined, 'audit_logs')).toContain('365');
    expect(rejectionReasonFor(DataClass.OPERATIONAL, 7, undefined, 'hr_audit_logs')).toContain(
      '365',
    );
    expect(rejectionReasonFor(DataClass.OPERATIONAL, 730, undefined, 'audit_logs')).toBeNull();
    // 0 keeps meaning "keep everything" here, exactly as it does elsewhere in this file.
    expect(rejectionReasonFor(DataClass.OPERATIONAL, 0, undefined, 'audit_logs')).toBeNull();
    // And it is the audit datasets only: a 7-day window on message history is a choice.
    expect(
      rejectionReasonFor(DataClass.OPERATIONAL, 7, undefined, 'notifications_messages'),
    ).toBeNull();
  });
});
