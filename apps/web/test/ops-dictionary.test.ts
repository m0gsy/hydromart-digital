import { describe, expect, it } from 'vitest';

import { opsFix as id } from '@/lib/dictionaries/id/opsFix';
import { opsFix as en } from '@/lib/dictionaries/en/opsFix';

// The inventory console was half-translated: some strings went through t(), others were
// typed straight into the JSX, so an English session still showed Indonesian. Moving them
// all into opsFix only helps if the two files stay in step — a key that exists in one and
// not the other renders the raw key name to a real operator.
function keys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('opsFix dictionary', () => {
  it('has the same keys in Indonesian and English', () => {
    expect(keys(id).sort()).toEqual(keys(en).sort());
  });

  it('leaves no value blank in either language', () => {
    for (const dict of [id, en]) {
      const blanks = Object.entries(dict).flatMap(([section, node]) =>
        Object.entries(node as Record<string, string>)
          .filter(([, v]) => typeof v === 'string' && v.trim() === '')
          .map(([k]) => `${section}.${k}`),
      );
      expect(blanks).toEqual([]);
    }
  });
});
