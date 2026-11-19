import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The nav TABLES are read by `canOpenRoute`, and `canOpenRoute` by every page that asks whether
 * a link may be drawn: search, ⌘K, order and customer detail, widget "see detail" links. While
 * the tables carried their icons, each of those pages bundled all of them (#938 measured 44–53
 * kB on four pages), which is why "do not import route-access into a light page" had become a
 * rule. The icons now live with the rails that draw them (`lib/ops-hub-icons.ts`, `HR_ICONS` in
 * the HR rail). This keeps them there: a value import of an icon set or of a component in any
 * of these three files is the regression. `import type` is erased at build and stays allowed.
 */
const read = (file: string) => readFileSync(join(__dirname, '../src', file), 'utf8');
const VALUE_IMPORT = /^import (?!type )[^;]*? from '([^']+)';/gm;

describe('the nav tables carry no icons', () => {
  for (const file of ['lib/ops-nav.ts', 'lib/hr-nav.ts', 'lib/route-access.ts']) {
    it(`${file} imports no icon set and no component`, () => {
      const from = [...read(file).matchAll(VALUE_IMPORT)].map((m) => m[1]!);
      expect(from.length).toBeGreaterThan(0);
      expect(from.filter((m) => m.includes('phosphor') || m.startsWith('@/components/'))).toEqual(
        [],
      );
    });
  }
});
