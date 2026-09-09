import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * CA-2-51 — a fixed colour on a ground that is not fixed.
 *
 * `check-theme-tokens.mjs` counts the remaining sites and ratchets them down; this pins the
 * RULE that gate encodes, on the screens the sweep actually rewrote. Both are source
 * properties, deliberately: the classes here are chosen in ternaries and lookup maps, and
 * proving "which colour reached the element" would mean mocking each screen's whole data
 * layer to assert a class name the file already states.
 *
 * The distinction worth keeping is the one a blanket replace would have destroyed: ink on a
 * themed surface must follow the theme, while ink on a card that is light in BOTH themes
 * must not. The dark-mode work before this proved the second half the hard way — `--danger`
 * is a LIGHT red under dark, so moving a `bg-red-50` card onto it makes its message harder
 * to read, not easier.
 */

/*
 * Comments stripped first. Every source-scanning check in this repo has, at least once,
 * flagged the comment EXPLAINING the fix: prose naming a class is not markup using it.
 */
const code = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const RAW_INK = /\b(text|border)-(red|green|amber|yellow|orange|emerald|rose)-\d{2,3}\b/g;
const FIXED_GROUND =
  /\bbg-(white|(?:red|green|amber|yellow|blue|emerald|orange|rose|sky|gray|slate)-(?:50|100))\b/;

describe('CA-2-51 console ink follows the theme', () => {
  it.each([
    'src/app/hq/health/page.tsx',
    'src/app/hq/franchise/page.tsx',
    'src/app/hr/adjustments/page.tsx',
    'src/components/dashboard/order-detail.tsx',
    'src/components/hq/sweep-card.tsx',
    'src/components/hr/employee-form.tsx',
    'src/components/operator/operator-ringkasan.tsx',
  ])('%s carries no fixed ink on a themed surface', (file) => {
    const src = code(file);
    const lines = src.split('\n');
    const offenders = lines
      .map((line, i) => ({ line, i: i + 1 }))
      .filter(({ line }) => RAW_INK.test(line) && !FIXED_GROUND.test(line))
      .map(({ i, line }) => `${file}:${i} ${line.trim().slice(0, 80)}`);
    RAW_INK.lastIndex = 0;
    expect(offenders).toEqual([]);
  });

  it('paints the operator warning tone with the warning token', () => {
    const src = code('src/components/operator/operator-ringkasan.tsx');
    // The tone is picked by a ternary, so what matters is that BOTH arms are tokens.
    expect(src).toContain("tone === 'amber' ? 'text-[color:var(--warning)]'");
  });

  it('keeps the saturated status swatches, which are not ink', () => {
    // A solid mid-weight colour carries its own contrast on either ground. Turning these
    // into tokens would wash out the one thing an operator scans the row for.
    expect(code('src/app/hq/incidents/page.tsx')).toMatch(/bg-(red|amber)-500/);
    expect(code('src/app/hq/churn/page.tsx')).toMatch(/bg-(green|amber|orange|red)-500/);
  });

  it('leaves ink alone where the card is light in both themes', () => {
    // Spot-check that the sweep did not "fix" the shape it was warned about: somewhere in
    // the app a fixed red still sits on a fixed red-50 card, and that is correct.
    const kept = ['src/components/ui.tsx', 'src/app/dashboard/incidents/page.tsx']
      .map(code)
      .some((src) =>
        src.split('\n').some((l) => FIXED_GROUND.test(l) && /\btext-(red|amber|green)-\d{2,3}\b/.test(l)),
      );
    expect(kept).toBe(true);
  });
});
