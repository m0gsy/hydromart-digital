import { describe, expect, it } from 'vitest';

import { flagEnabled, flagOn } from '../src/lib/feature-flags';

// Fail-OPEN: a flag is off only when the server said so.
describe('flagEnabled', () => {
  const flags = [
    { key: 'payments.cash_on_delivery', enabled: false },
    { key: 'subscriptions.galon', enabled: true },
  ];

  it('is off only for a flag the server reported as disabled', () => {
    expect(flagEnabled(flags, 'payments.cash_on_delivery')).toBe(false);
    expect(flagEnabled(flags, 'subscriptions.galon')).toBe(true);
  });

  it('is on for a key the list does not carry', () => {
    expect(flagEnabled(flags, 'recommendations.ai')).toBe(true);
  });

  it('is on while the read is pending or after it failed', () => {
    expect(flagEnabled(null, 'payments.cash_on_delivery')).toBe(true);
    expect(flagEnabled(undefined, 'subscriptions.galon')).toBe(true);
  });
});

// Fail-CLOSED (flow 5d): a brake is released only when the server said so.
describe('flagOn', () => {
  it('is on only for a brake the server reported as enabled', () => {
    expect(
      flagOn([{ key: 'attendance.courier_one_tap', enabled: true }], 'attendance.courier_one_tap'),
    ).toBe(true);
    expect(
      flagOn([{ key: 'attendance.courier_one_tap', enabled: false }], 'attendance.courier_one_tap'),
    ).toBe(false);
  });

  it('is off for a key the list does not carry, and while the read is pending or after it failed', () => {
    expect(
      flagOn([{ key: 'subscriptions.galon', enabled: true }], 'attendance.courier_one_tap'),
    ).toBe(false);
    expect(flagOn(null, 'attendance.courier_one_tap')).toBe(false);
    expect(flagOn(undefined, 'attendance.courier_one_tap')).toBe(false);
    // An error body is not the list.
    expect(flagOn({ message: 'down' } as never, 'attendance.courier_one_tap')).toBe(false);
  });
});
