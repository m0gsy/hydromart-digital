import { describe, expect, it } from 'vitest';

import { prospects as en } from '@/lib/dictionaries/en/prospects';
import { prospectsField as enField } from '@/lib/dictionaries/en/prospectsField';
import { prospectsField as idField } from '@/lib/dictionaries/id/prospectsField';
import { prospects as id } from '@/lib/dictionaries/id/prospects';
import { DNC_REASONS, PROSPECT_CATEGORIES, PROSPECT_OUTCOMES, PROSPECT_SOURCES } from '@/lib/prospect-labels';
import { PROSPECT_STATUSES } from '@/lib/prospect-status';

const keys = (o: unknown, prefix = ''): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('prospects dictionary', () => {
  it('has the same keys in id and en', () => {
    expect(keys(en).sort()).toEqual(keys(id).sort());
  });

  it('has the same field-work keys in id and en', () => {
    expect(keys(enField).sort()).toEqual(keys(idField).sort());
  });

  it('labels every enum value the screens can show, in both languages', () => {
    for (const [group, values] of [
      ['status', PROSPECT_STATUSES],
      ['category', PROSPECT_CATEGORIES],
      ['outcome', PROSPECT_OUTCOMES],
      ['source', PROSPECT_SOURCES],
      ['dnc', DNC_REASONS],
    ] as const) {
      for (const dict of [id, en]) {
        expect(Object.keys(dict[group]).sort()).toEqual([...values].sort());
      }
    }
  });
});
