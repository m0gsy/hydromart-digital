import { describe, expect, it } from 'vitest';

import { dayKey, formatSchedule, slotInstant } from '@/lib/delivery-schedule';

// Depot slots are Jakarta wall-clock windows. The order stores the real instant they start, so
// the browser must build it from the JAKARTA calendar day, not from the device's zone.
describe('slotInstant', () => {
  const now = new Date('2026-08-31T01:00:00Z'); // 08:00 on 31 Aug in Jakarta

  it('is the instant a slot starts, for today and for later days', () => {
    expect(slotInstant(0, '09.00-11.00', now)).toBe('2026-08-31T02:00:00.000Z');
    expect(slotInstant(1, '11.00-13.00', now)).toBe('2026-09-01T04:00:00.000Z');
    expect(slotInstant(3, '15.30-17.30', now)).toBe('2026-09-03T08:30:00.000Z');
  });

  it('counts days on the Jakarta calendar: 23:00 UTC is already tomorrow there', () => {
    const lateUtc = new Date('2026-08-31T23:00:00Z'); // 06:00 on 1 Sep in Jakarta
    expect(slotInstant(0, '09.00-11.00', lateUtc)).toBe('2026-09-01T02:00:00.000Z');
  });

  it('crosses a month end', () => {
    expect(slotInstant(2, '09.00-11.00', now)).toBe('2026-09-02T02:00:00.000Z');
  });

  it('returns null for something that is not a slot', () => {
    expect(slotInstant(0, 'Kam, 09.00-11.00', now)).toBeNull();
    expect(slotInstant(0, '', now)).toBeNull();
  });
});

describe('formatSchedule', () => {
  it('prints the booked day and time in Jakarta time', () => {
    const out = formatSchedule('2026-09-01T02:00:00.000Z', 'id');
    expect(out).toMatch(/1/);
    expect(out).toMatch(/09[.:]00/);
  });

  it('is empty for no schedule', () => {
    expect(formatSchedule(null, 'id')).toBe('');
    expect(formatSchedule(undefined, 'id')).toBe('');
  });
});

describe('dayKey', () => {
  const now = new Date('2026-08-31T01:00:00Z'); // 08:00 on 31 Aug in Jakarta

  it('is the Jakarta calendar day, N days from today, as the depot lists its closed days', () => {
    expect(dayKey(0, now)).toBe('2026-08-31');
    expect(dayKey(1, now)).toBe('2026-09-01');
    expect(dayKey(3, now)).toBe('2026-09-03');
  });

  it('counts from the Jakarta day: 23:00 UTC is already tomorrow there', () => {
    expect(dayKey(0, new Date('2026-08-31T23:00:00Z'))).toBe('2026-09-01');
  });
});
