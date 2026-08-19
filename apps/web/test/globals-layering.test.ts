import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * O11. `.surface` used to live outside any cascade layer. Unlayered CSS beats every
 * layered rule regardless of specificity, and Tailwind v4 puts all of its utilities in
 * `@layer utilities` — so `<Card className="bg-brand-600">` kept the light surface while
 * the white text meant for the dark background still applied. White on white, on 46 call
 * sites across the courier app, the depot dashboard and HQ.
 *
 * This is the ratchet. It reads the stylesheet rather than the rendered page because the
 * failure is a cascade-ordering property of the file itself: the moment one of these
 * shortcuts is written outside `@layer`, it silently outranks the caller again.
 */
const CSS = readFileSync(join(__dirname, '../src/app/globals.css'), 'utf8');

/** The class bodies a caller is expected to be able to override with a utility. */
const OVERRIDABLE = [
  '.surface',
  '.surface-elevated',
  '.surface-soft',
  '.text-muted',
  '.border-app',
  '.shadow-card',
  '.shadow-lift',
];

/** Byte ranges of every `@layer <name> { ... }` block, brace-matched. */
function layerRanges(css: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const opener = /@layer\s+[\w\s,]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    out.push({ start: m.index, end: i });
  }
  return out;
}

describe('globals.css cascade layers (O11)', () => {
  const ranges = layerRanges(CSS);

  it('declares at least one cascade layer', () => {
    expect(ranges.length).toBeGreaterThan(0);
  });

  it.each(OVERRIDABLE)('%s is declared inside a cascade layer', (selector) => {
    // The rule, not a mention: `.surface {` at the start of a line, not `.surface-soft`.
    const at = CSS.search(new RegExp(`^\\s*\\${selector}\\s*\\{`, 'm'));
    expect(at, `${selector} is not declared at all`).toBeGreaterThan(-1);
    expect(
      ranges.some((r) => at > r.start && at < r.end),
      `${selector} is declared outside @layer — it will beat every Tailwind utility a caller passes`,
    ).toBe(true);
  });
});
