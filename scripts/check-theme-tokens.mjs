#!/usr/bin/env node
/**
 * CA-2-51 — raw Tailwind colours on a surface that follows the theme.
 *
 *   node scripts/check-theme-tokens.mjs           # fail if the count grew
 *   node scripts/check-theme-tokens.mjs --list    # show every remaining site
 *   node scripts/check-theme-tokens.mjs --write   # record the current count
 *
 * A fixed colour is only a defect when the ground under it is NOT fixed. Reading the actual
 * sites is what taught this gate its shape, and it is why the rule is not "no raw colours":
 *
 *  - `text-red-600` on a themed card is the bug: the card flips under dark, the ink does
 *    not, and the message becomes the colour of a bruise on a dark ground.
 *  - the SAME class on `bg-red-50` is correct. That card is light in both themes, and
 *    `--danger` is a LIGHT red under dark, so "fixing" it makes contrast worse. The
 *    dark-mode test shipped with CA-3-64 already proves this.
 *  - `bg-amber-500` as a status dot or a progress bar is correct too: a saturated mid
 *    colour carries its own contrast on either ground. It is a swatch, not ink.
 *
 * So the gate looks for TEXT and BORDER colours on lines that do not also carry a fixed
 * light ground. It ratchets rather than blocks: the number may fall, never rise, which is
 * how the rest of this repo carries a debt it cannot clear in one pass.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src';
const BASELINE = 'scripts/theme-tokens-baseline.json';

const TEXTISH =
  /\b(text|border)-(red|green|amber|yellow|orange|emerald|rose|gray|slate)-([0-9]{2,3})\b/g;
/** A ground that is light in BOTH themes: the ink on it is meant to stay fixed. */
const FIXED_GROUND =
  /\bbg-(white|(?:red|green|amber|yellow|blue|emerald|orange|rose|sky|gray|slate)-(?:50|100))\b/;

/** Prose naming a class is not markup using it — every source scan here has learnt this. */
const code = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

const sites = [];
for (const file of walk(ROOT)) {
  const lines = code(readFileSync(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (FIXED_GROUND.test(line)) return;
    const found = line.match(TEXTISH);
    if (found) sites.push({ file, line: i + 1, classes: found.join(' '), text: line.trim() });
  });
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of sites) console.log(`${s.file}:${s.line}  ${s.classes}\n    ${s.text.slice(0, 120)}`);
  console.log(`\n${sites.length} site(s).`);
  process.exit(0);
}

if (args.includes('--write')) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ count: sites.length, files: [...new Set(sites.map((s) => s.file))].sort() }, null, 2)}\n`,
  );
  console.log(`theme-tokens: recorded ${sites.length} remaining site(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { count: 0 };

if (sites.length > baseline.count) {
  console.error(
    `theme-tokens: ${sites.length} raw colour(s) on themed surfaces, baseline ${baseline.count}.`,
  );
  const known = new Set(baseline.files ?? []);
  const fresh = sites.filter((s) => !known.has(s.file));
  if (fresh.length) {
    console.error('\n  new file(s) carrying one:');
    for (const s of fresh.slice(0, 20)) console.error(`    ${s.file}:${s.line}  ${s.classes}`);
  }
  console.error(
    '\n  A fixed colour needs a fixed ground. On a surface that follows the theme use the\n' +
      '  tokens: --danger, --success, --warning, or the `text-muted` / `border-app` utility.\n' +
      '  If the ground really is always light (a bg-*-50 card), say so on the same line and\n' +
      '  this gate stops counting it.',
  );
  process.exit(1);
}

if (sites.length < baseline.count) {
  console.log(
    `theme-tokens: ${sites.length} remaining (was ${baseline.count}) — run --write to lock the gain in.`,
  );
  process.exit(0);
}

console.log(`theme-tokens: ${sites.length} remaining, none new.`);
