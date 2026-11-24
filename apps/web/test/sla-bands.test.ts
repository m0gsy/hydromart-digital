import { describe, expect, it } from 'vitest';

import { SLA_CRITICAL_PCT, SLA_HEALTHY_PCT, isSlaCritical } from '../src/lib/sla-bands';

describe('shared SLA colour band (HD-6 #19)', () => {
  it('uses the policy bands: healthy from 95, critical below 85', () => {
    expect(SLA_HEALTHY_PCT).toBe(95);
    expect(SLA_CRITICAL_PCT).toBe(85);
  });

  it('is critical strictly below the critical band', () => {
    expect(isSlaCritical(84.9)).toBe(true);
    expect(isSlaCritical(85)).toBe(false);
    expect(isSlaCritical(100)).toBe(false);
  });
});
