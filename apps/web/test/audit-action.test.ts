import { describe, expect, it } from 'vitest';

import { actionLabel } from '@/lib/audit-action';
import { id } from '@/lib/dictionaries/id';

const t = (key: string): string => {
  const got = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], id);
  return typeof got === 'string' ? got : key;
};

describe('actionLabel', () => {
  it('reads known tokens as words', () => {
    expect(actionLabel('api-keys.rotate', t)).toBe('Kunci API diputar ulang');
    expect(actionLabel('settings.changed', t)).toBe('Pengaturan diubah');
    expect(actionLabel('feature-flags.express-fee.changed', t)).toBe('Feature flag · Biaya ekspres diubah');
  });
  it('still reads an unknown token, and never returns an empty string for a code', () => {
    expect(actionLabel('PAYROLL_UNAPPROVE', t)).toBe('PAYROLL UNAPPROVE');
    expect(actionLabel('', t)).toBe('');
  });
});
