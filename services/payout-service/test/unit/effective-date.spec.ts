import { InvalidEffectiveDateError } from '../../src/domain/errors';

import { effectiveFrom } from '../../src/domain/effective-date';

describe('effectiveFrom', () => {
  it('reads a date-only value as the start of that WIB day', () => {
    expect(effectiveFrom('2026-08-01', 'Asia/Jakarta').toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(effectiveFrom('2027-01-01', 'Asia/Jakarta').toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
  it('keeps a full timestamp untouched', () => {
    expect(effectiveFrom('2026-08-01T16:59:00.000Z', 'Asia/Jakarta').toISOString()).toBe(
      '2026-08-01T16:59:00.000Z',
    );
  });
  it('refuses a day that does not exist instead of rolling it to another day', () => {
    expect(() => effectiveFrom('2026-02-30', 'Asia/Jakarta')).toThrow(InvalidEffectiveDateError);
    expect(() => effectiveFrom('2026-02-29', 'Asia/Jakarta')).toThrow(InvalidEffectiveDateError);
    expect(() => effectiveFrom('2026-13-01', 'Asia/Jakarta')).toThrow();
  });
  it('accepts a real leap day and a year end', () => {
    expect(effectiveFrom('2028-02-29', 'Asia/Jakarta').toISOString()).toBe('2028-02-28T17:00:00.000Z');
    expect(effectiveFrom('2026-12-31', 'Asia/Jakarta').toISOString()).toBe('2026-12-30T17:00:00.000Z');
  });
});
