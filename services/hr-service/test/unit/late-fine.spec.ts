import { parseFines, tierOf } from '../../src/domain/late-fine';

// SOP: jam masuk 07.50, toleransi 25 menit, telat 2 dari 09.00 (70'), tidak absen dari
// 10.00 (130'). Staf 10/15/20 ribu; kepala depot 15/20/25 ribu.
const TIER2 = 70;
const ABSENT = 130;

describe('parseFines', () => {
  it('parses the SOP three-number table', () => {
    expect(parseFines('10000,15000,20000')).toEqual({
      tier1: 10000,
      tier2: 15000,
      absent: 20000,
    });
    expect(parseFines(' 15000 , 20000 , 25000 ')).toEqual({
      tier1: 15000,
      tier2: 20000,
      absent: 25000,
    });
  });

  it('returns null — not three zeroes — for an unset depot', () => {
    // The difference matters: null keeps the old flat deduction, zeroes would silently
    // delete it.
    expect(parseFines('')).toBeNull();
  });

  it('returns null for anything that is not exactly three non-negative numbers', () => {
    expect(parseFines('10000,15000')).toBeNull();
    expect(parseFines('10000,15000,20000,25000')).toBeNull();
    expect(parseFines('10000,,20000')).toBeNull();
    expect(parseFines('10000,abc,20000')).toBeNull();
    expect(parseFines('-1,15000,20000')).toBeNull();
  });

  it('accepts a zero step — a depot may fine only the later tiers', () => {
    expect(parseFines('0,15000,20000')).toEqual({ tier1: 0, tier2: 15000, absent: 20000 });
  });
});

describe('tierOf', () => {
  it('fines nothing for an on-time day', () => {
    // lateMinutes is already 0 for anyone inside the tolerance window.
    expect(tierOf(0, TIER2, ABSENT)).toBe('NONE');
  });

  it('is tier 1 from the first late minute up to the tier-2 boundary', () => {
    expect(tierOf(26, TIER2, ABSENT)).toBe('T1');
    expect(tierOf(69, TIER2, ABSENT)).toBe('T1');
  });

  it('is tier 2 from the boundary itself (09.00 = 70 minutes after 07.50)', () => {
    expect(tierOf(70, TIER2, ABSENT)).toBe('T2');
    expect(tierOf(129, TIER2, ABSENT)).toBe('T2');
  });

  it('counts as not attended from the absent boundary (10.00 = 130 minutes)', () => {
    expect(tierOf(130, TIER2, ABSENT)).toBe('ABSENT');
    expect(tierOf(300, TIER2, ABSENT)).toBe('ABSENT');
  });

  it('treats a 0 boundary as "step not configured", not as "every minute crosses it"', () => {
    expect(tierOf(500, 0, 0)).toBe('T1');
    expect(tierOf(500, TIER2, 0)).toBe('T2');
    expect(tierOf(500, 0, ABSENT)).toBe('ABSENT');
  });
});
