import { BadRequestException } from '@nestjs/common';

import { parsePeriod } from '../../src/application/ai-read/period';

// 2026-11-25 10:00 WIB
const NOW = new Date('2026-11-25T03:00:00.000Z');
type Q = Parameters<typeof parsePeriod>[0];
type O = Parameters<typeof parsePeriod>[2];
const p = (q: Q, o?: O) => parsePeriod(q, NOW, o);

describe('parsePeriod (WIB calendar)', () => {
  it('echoes a month as its WIB bounds and the UTC instants they stand for', () => {
    expect(p({ period: 'month', date: '2026-11-25' })).toEqual({
      unit: 'month',
      from: '2026-11-01',
      to: '2026-11-30',
      timeZone: 'Asia/Jakarta',
      fromAt: '2026-10-31T17:00:00.000Z',
      toAt: '2026-11-30T17:00:00.000Z',
    });
  });

  it('uses today in WIB, not in UTC, when no date is given', () => {
    // 23:30 UTC on the 24th is already the 25th in Jakarta
    const late = parsePeriod({ period: 'day' }, new Date('2026-11-24T23:30:00.000Z'));
    expect(late.from).toBe('2026-11-25');
    expect(late.fromAt).toBe('2026-11-24T17:00:00.000Z');
    expect(late.toAt).toBe('2026-11-25T17:00:00.000Z');
  });

  it('ends a year on 31 Dec and a month on the leap day', () => {
    expect(p({ period: 'year', date: '2026-06-15' })).toMatchObject({
      from: '2026-01-01',
      to: '2026-12-31',
      toAt: '2026-12-31T17:00:00.000Z',
    });
    expect(p({ period: 'month', date: '2028-02-10' })).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(p({ period: 'month', date: '2026-02-10' })).toMatchObject({ to: '2026-02-28' });
    expect(p({ period: 'year', date: '2028-12-31' })).toMatchObject({ from: '2028-01-01', to: '2028-12-31' });
  });

  it('runs a week Monday to Sunday, across a month end', () => {
    expect(p({ period: 'week', date: '2026-11-25' })).toMatchObject({ from: '2026-11-23', to: '2026-11-29' });
    expect(p({ period: 'week', date: '2026-11-29' })).toMatchObject({ from: '2026-11-23', to: '2026-11-29' });
    expect(p({ period: 'week', date: '2026-12-01' })).toMatchObject({ from: '2026-11-30', to: '2026-12-06' });
  });

  it('takes an explicit range, both ends included', () => {
    expect(p({ from: '2026-11-05', to: '2026-11-20' })).toMatchObject({
      unit: 'range',
      from: '2026-11-05',
      to: '2026-11-20',
    });
    expect(p({ from: '2026-11-05', to: '2026-11-05' })).toMatchObject({
      fromAt: '2026-11-04T17:00:00.000Z',
      toAt: '2026-11-05T17:00:00.000Z',
    });
  });

  it('refuses what is ambiguous or not a real day', () => {
    const bad = (q: Q) => expect(() => p(q)).toThrow(BadRequestException);
    bad({});
    bad({ period: 'month', from: '2026-11-01', to: '2026-11-30' });
    bad({ from: '2026-11-01' });
    bad({ to: '2026-11-30' });
    bad({ from: '2026-11-01', to: '2026-11-30', date: '2026-11-05' });
    bad({ period: 'decade' });
    bad({ period: 'month', date: '2026-02-30' });
    bad({ from: '2026-11-30', to: '2026-11-01' });
    bad({ from: '2026-1-1', to: '2026-11-01' });
  });

  it('refuses a year past 9998 with 400, not a RangeError', () => {
    expect(() => p({ period: 'day', date: '9999-12-31' })).toThrow(BadRequestException);
    expect(() => p({ from: '9999-01-01', to: '9999-12-31' })).toThrow(BadRequestException);
    expect(p({ period: 'year', date: '9998-06-01' }).to).toBe('9998-12-31');
  });

  it('allows a range of 366 days (a leap year) and refuses 367', () => {
    expect(p({ from: '2028-01-01', to: '2028-12-31' }).unit).toBe('range');
    expect(() => p({ from: '2028-01-01', to: '2029-01-01' })).toThrow('366');
  });

  it('refuses a range that is not whole weeks/months/years where the metric needs them', () => {
    const w = (q: Q, whole: 'week' | 'month' | 'year') => () => p(q, { whole });
    expect(w({ from: '2026-11-01', to: '2026-11-30' }, 'month')()).toMatchObject({ unit: 'range' });
    expect(w({ from: '2026-10-01', to: '2026-11-30' }, 'month')()).toMatchObject({ from: '2026-10-01' });
    expect(w({ from: '2026-11-02', to: '2026-11-30' }, 'month')).toThrow(BadRequestException);
    expect(w({ from: '2026-11-01', to: '2026-11-29' }, 'month')).toThrow(BadRequestException);
    expect(w({ from: '2026-01-01', to: '2026-12-31' }, 'year')()).toMatchObject({ to: '2026-12-31' });
    expect(w({ from: '2026-01-01', to: '2026-12-30' }, 'year')).toThrow(BadRequestException);
    expect(w({ from: '2026-02-01', to: '2026-12-31' }, 'year')).toThrow(BadRequestException);
    expect(w({ from: '2026-11-23', to: '2026-11-29' }, 'week')()).toMatchObject({ from: '2026-11-23' });
    expect(w({ from: '2026-11-24', to: '2026-11-30' }, 'week')).toThrow(BadRequestException);
    expect(w({ from: '2026-11-23', to: '2026-11-28' }, 'week')).toThrow(BadRequestException);
    // a named period is whole by construction
    expect(p({ period: 'month', date: '2026-11-25' }, { whole: 'month' }).to).toBe('2026-11-30');
  });
});
