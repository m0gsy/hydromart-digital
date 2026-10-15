import { describe, expect, it } from 'vitest';

import { flagEnabled } from '../src/lib/feature-flags';

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
