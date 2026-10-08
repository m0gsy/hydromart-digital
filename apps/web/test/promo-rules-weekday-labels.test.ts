import { describe, expect, it } from 'vitest';

import { en } from '@/lib/dictionaries/en';
import { id } from '@/lib/dictionaries/id';

/**
 * Both promo-rules pages build their weekday checkboxes from `t('<ns>.promoRules.days.<0-6>')`.
 * Those are template-literal keys, which locale-keys.test.ts deliberately does not collect, and
 * `t()` returns the KEY ITSELF for any value that is not a string. The weekdays were first stored
 * as an array: nothing failed to compile, and opening the "new rule" editor then threw
 * `.map is not a function` on both pages. This pins every weekday to a real string.
 */
const lookup = (dict: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
      dict,
    );

describe('promo-rules weekday labels', () => {
  for (const ns of ['hq', 'dashboard']) {
    for (const [locale, dict] of Object.entries({ id, en })) {
      it(`${locale}: ${ns}.promoRules.days.0..6 are all non-empty strings`, () => {
        for (let day = 0; day <= 6; day++) {
          const value = lookup(dict, `${ns}.promoRules.days.${day}`);
          expect(typeof value, `${locale} ${ns}.promoRules.days.${day}`).toBe('string');
          expect(value).not.toBe('');
        }
      });
    }
  }
});
