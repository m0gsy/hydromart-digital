#!/usr/bin/env node
/**
 * Audit Q-17: the performance baseline is only worth something if it stays true.
 *
 * `docs/perf/BASELINE.md` records, per hot path, what one request costs in round-trips and
 * names the test that holds it there. A table row whose test has been renamed, deleted or
 * quietly stopped asserting is worse than no row at all — it reads as a guarantee and is not
 * one. This check reads the table, resolves every `Pinned by` reference, and fails if the
 * file or the test name is gone.
 *
 * It deliberately does NOT run the tests (CI already does, with coverage). It checks that the
 * claim and the test still point at each other.
 *
 *   node scripts/check-perf-baseline.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = join(root, 'docs', 'perf', 'BASELINE.md');

if (!existsSync(baseline)) {
  console.error('MISSING docs/perf/BASELINE.md — the Q-17 baseline is the audit deliverable.');
  process.exit(1);
}

const text = readFileSync(baseline, 'utf8');

// `path/to.spec.ts` → `assertion name` — one or more per table cell, separated by commas.
// A cell with a path but no arrow is a promise with nothing behind it, and is rejected.
const CELL = /`([^`]+\.(?:spec|test)\.ts)`(?:\s*→\s*`([^`]+)`)?/g;

const problems = [];
let rows = 0;

for (const line of text.split('\n')) {
  if (!line.startsWith('|') || !line.includes('.ts`')) continue;
  rows += 1;
  let match;
  CELL.lastIndex = 0;
  while ((match = CELL.exec(line)) !== null) {
    const [, relative, assertion] = match;
    const file = join(root, relative); // join normalises the forward slashes on Windows too
    if (!existsSync(file)) {
      problems.push(`${relative}: file does not exist (row: ${line.slice(0, 40).trim()}…)`);
      continue;
    }
    if (!assertion) {
      problems.push(`${relative}: named without a test title — say which test pins the number`);
      continue;
    }
    if (!readFileSync(file, 'utf8').includes(assertion)) {
      problems.push(`${relative}: no test titled "${assertion}"`);
    }
  }
}

if (rows === 0) {
  console.error('docs/perf/BASELINE.md has no pinned rows — nothing is being held.');
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`Performance baseline is stale — ${problems.length} broken reference(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nFix the test name in docs/perf/BASELINE.md, or restore the test.');
  process.exit(1);
}

console.log(`Performance baseline OK — ${rows} pinned hot path(s), every test present.`);
