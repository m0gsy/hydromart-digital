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
});
