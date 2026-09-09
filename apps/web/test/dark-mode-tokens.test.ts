import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CA-3-60 and CA-3-64 — colours that stop meaning anything when the theme flips.
 *
 * Both rows are the same defect: a FIXED colour on a surface that is not fixed. The two
 * fixes are not the same, though, and the difference is the whole reason this file exists
 * rather than one `sed`:
 *
 *  - `.text-deep-teal` is a constant #0b4d57 BY DESIGN, for dark text on an always-light
 *    surface (the frosted hero pills, the white promo button). Three of its five uses are
 *    exactly that and must not change. Two were on themed surfaces, and those are the bug.
 *  - `text-red-600` is a Tailwind constant used 113 times. Most are error text on a themed
 *    surface and belong on `--danger`. Some sit on `bg-red-50` cards that are light in both
 *    themes, where `--danger` (a LIGHT red under dark) would be worse than what is there.
 *
 * So the sweep is scoped by what the markup says about itself — `role="alert"` — rather
 * than by the colour name. A blanket replace would have made contrast worse in the places
 * it was already fine.
 */

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });

const SRC = walk('src');
const read = (f: string) => readFileSync(f, 'utf8');

/*
 * Comments stripped before any class-name assertion. Every source-scanning check written
 * tonight has, at first, flagged the comment EXPLAINING the fix — prose naming a class is
 * not markup using it. The conflict-marker gate learned this the same way.
 */
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('CA-3-64 error text follows the theme', () => {
  it('leaves no alert painted with a fixed red', () => {
    const offenders = SRC.flatMap((f) =>
      read(f)
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter((l) => l.line.includes('role="alert"') && l.line.includes('text-red-600')),
    );
    // `--danger` is #b3261e in light and #f87171 in dark; `text-red-600` is #dc2626 in both,
    // which on a dark surface is the colour of a bruise.
    expect(offenders.map((o) => `${o.f}:${o.i}`)).toEqual([]);
  });

  it('keeps the shared form error and LoadError on the token', () => {
    const ui = read('src/components/ui.tsx');
    // Every form in the app renders through these two.
    expect(ui).toContain("text-xs font-medium text-[color:var(--danger)]");
    expect(ui).toContain("cx('text-xs text-[color:var(--danger)]', className)");
  });
});

describe('CA-3-60 deep-teal stays where it belongs', () => {
  it('is gone from the two themed surfaces, and kept on the always-light ones', () => {
    const orderViews = code('src/components/order-views.tsx');
    // The courier ETA and the history note sit on surfaces that go dark. They were 1.47:1.
    expect(orderViews).not.toContain('text-deep-teal');

    // These three are the class working as designed: dark text on a surface that is white
    // in both themes. Changing them would be the opposite mistake.
    for (const f of ['src/components/hero.tsx', 'src/components/promo-carousel.tsx']) {
      expect(code(f)).toContain('text-deep-teal');
    }
  });
});
