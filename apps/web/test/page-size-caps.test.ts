import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A console read may not ask for more rows than the server will give it.
 *
 * This defect has now happened twice, in two different screens, with the same shape and the
 * same silent outcome:
 *
 *   - `hq/staff` asked for `pageSize: 500` (K-5/C-2). `ListEmployeesDto` caps it at 100, so
 *     the read 400'd and the reconciliation badge simply disappeared.
 *   - `hr/assets` asked for `pageSize: 200`, and was still doing it on 2026-09-10. The
 *     screen printed "Gagal dimuat. Coba lagi" in red ABOVE an asset list that had loaded
 *     perfectly — so the failure looked like the assets, and the real cost was the one that
 *     file's own comment predicts: "an assigned asset reads as held by nobody and there is
 *     no one to hand it to".
 *
 * Neither was caught by a test, because both are a number in a page that renders its own
 * error state politely. `scripts/check-page-size.mjs` guards the SERVER's `PAGE_SIZE`
 * constants against each service's cap; nothing guarded the client asking.
 *
 * 100 is the cap every paged HR/console DTO in this repo declares (`@Max(100)`). A read that
 * genuinely needs the whole set pages for it — see `readWholeRoster` in `hr/assets` and
 * `readLinkedAccountIds` in `hq/staff`, which both loop at 100.
 */
const MAX = 100;
const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('console reads stay inside the server page cap', () => {
  it(`asks for at most ${MAX} rows a page, everywhere`, () => {
    const over: string[] = [];
    for (const file of walk(SRC)) {
      // Prose naming a number is not a call — `hq/staff` documents the 500 it no longer
      // asks for, and a scanner that cannot tell the two apart reports the fix as the bug.
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // `pageSize: 250`, `pageSize:250`, and the `limit:` spelling the same builders take.
      for (const m of src.matchAll(/\b(?:pageSize|limit)\s*:\s*(\d+)\b/g)) {
        const n = Number(m[1]);
        if (n > MAX) {
          const line = src.slice(0, m.index).split('\n').length;
          over.push(`${file.slice(SRC.length + 1).replace(/\\/g, '/')}:${line} → ${m[0]}`);
        }
      }
    }
    expect(
      over,
      `A read asking for more than ${MAX} rows is refused by the server with a 400, and the\n` +
        `screen renders its own error state — so it looks like the DATA failed, not the ask.\n` +
        `Page at ${MAX} instead (see readWholeRoster / readLinkedAccountIds):\n  ` +
        over.join('\n  '),
    ).toEqual([]);
  });
});
