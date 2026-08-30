#!/usr/bin/env bash
# Self-check for the Lighthouse ratchet — no browser, no network, runs in a second.
#
# It exists because the gate's most important half was dead for its entire life: the baseline
# was recorded before `bytes`/`requests`/`domNodes` were added, the comparison skipped any
# metric the baseline had no key for, and so the byte, request and DOM ceilings gated NOTHING
# while printing "Lighthouse ratchet OK". Nothing failed. That is what a silent no-op buys you.
#
# So this asserts the two things that cannot be seen from a green run:
#   1. every page in the baseline carries every metric the gate knows how to check
#   2. the performance score is reduced with `max`, not a median
set -euo pipefail
cd "$(dirname "$0")/.."

node --check scripts/check-lighthouse.mjs

node - <<'NODE'
const { readFileSync } = require('node:fs');
const src = readFileSync('scripts/check-lighthouse.mjs', 'utf8');
const baseline = JSON.parse(readFileSync('scripts/lighthouse-baseline.json', 'utf8'));

// The metric names the gate compares, read from the gate itself so the two cannot drift.
const weights = [...src.matchAll(/^\s{2}(\w+): \{\n\s+label:/gm)].map((m) => m[1]);
const categories = JSON.parse(
  src.match(/const CATEGORIES = (\[[^\]]+\])/)[1].replace(/'/g, '"'),
);
if (weights.length === 0) throw new Error('no weight metrics parsed — this check went blind');

const missing = [];
for (const [page, scores] of Object.entries(baseline)) {
  for (const key of [...categories, ...weights]) {
    if (typeof scores[key] !== 'number') missing.push(`${page}.${key}`);
  }
}
if (missing.length) {
  console.error('Baseline is missing metrics the gate checks, so they gate nothing:');
  for (const m of missing) console.error(`  - ${m}`);
  console.error('Run: node scripts/check-lighthouse.mjs --update');
  process.exit(1);
}

if (!/STATISTIC = \{ performance: 'max' \}/.test(src)) {
  console.error(
    'Performance is no longer reduced with `max`. A median left ±26 points of spread against\n' +
      'a tolerance of 8 and failed a PR that touched no frontend code. If this changed on\n' +
      'purpose, change this check too and say why.',
  );
  process.exit(1);
}

console.log(
  `check-lighthouse self-check OK — ${Object.keys(baseline).length} page(s) carry all ` +
    `${categories.length + weights.length} gated metrics; performance reduced with max.`,
);
NODE

node - <<'NODE'
const { readFileSync } = require('node:fs');
const src = readFileSync('scripts/check-lighthouse.mjs', 'utf8');

/*
 * A budget that only says pass/fail hides how it was spent.
 *
 * `/` requests drifted 46 -> 50 against a ceiling of 51 across many PRs, each one individually
 * under the line, and nothing ever printed a number anybody could watch. By the time it went
 * red the debt belonged to nobody: the PR that tipped it had added one request to a page four
 * others had already filled. Measured 2026-08-30, FIVE metrics were within noise of red —
 * `/products` requests had ZERO slack, `/driver` bytes 254, `/login` bytes 460 — and this gate
 * printed OK every single time.
 *
 * So the passing path reports headroom, and a metric inside 1% of its ceiling raises a
 * ::warning:: the run surfaces. Asserted here because a report nobody prints is a report
 * nobody reads.
 */
const wants = [
  ['headroom.push(', 'the passing path must collect how much budget is left'],
  ['Headroom left before the ceiling', 'and it must print it'],
  ['::warning::', 'a nearly-exhausted budget must raise a warning on the run'],
];
const missing = wants.filter(([needle]) => !src.includes(needle));
if (missing.length) {
  console.error('The headroom report is gone, so drift under the ceiling is invisible again:');
  for (const [needle, why] of missing) console.error(`  - ${why} (looked for: ${needle})`);
  process.exit(1);
}
NODE
