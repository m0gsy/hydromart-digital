import { describe, expect, it } from 'vitest';

import { trendLabel } from '@/lib/forecast';

describe('trendLabel', () => {
  it('labels a clear positive slope as rising', () => {
    expect(trendLabel(0.5)).toBe('↑ rising');
    expect(trendLabel(0.06)).toBe('↑ rising');
  });

  it('labels a clear negative slope as falling', () => {
    expect(trendLabel(-0.5)).toBe('↓ falling');
    expect(trendLabel(-0.06)).toBe('↓ falling');
  });

  it('labels near-zero slopes (within ±epsilon) as flat', () => {
    expect(trendLabel(0)).toBe('→ flat');
    expect(trendLabel(0.05)).toBe('→ flat');
    expect(trendLabel(-0.05)).toBe('→ flat');
  });
});
