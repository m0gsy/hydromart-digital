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
 *
 * ---------------------------------------------------------------------------------------
 * Second job, added because the first one was not enough.
 *
 * The Latency table said `_not yet run_` for the whole life of this file, and this check
 * exited 0 the entire time — measured: with the placeholder in place it printed
 * "Performance baseline OK — 28 pinned hot path(s)" and returned 0. Meanwhile `load.yml` had
 * run to green (32686490758, 2026-08-24) and produced real p95 numbers that reached nobody,
 * because filling the table was a manual step and manual steps are the ones that rot. A
 * baseline that is allowed to stay empty forever is not a baseline, and a gate that cannot
 * go red for its own subject is the defect class this whole area exists to close.
 *
 * So the Latency section must now carry at least one dated row, and `load.yml` writes those
 * rows itself:
 *
 *   node scripts/check-perf-baseline.mjs --record \
 *     --checkout checkout.summary.json --dashboards dashboards.summary.json \
 *     --run 123 --sha abc1234 --vus 10 --host gh-ubuntu-24.04/4c/16g
 *
 * The writer lives here rather than in the workflow on purpose: this is the file that knows
 * the table's shape, so writer and reader cannot drift apart — and `--record` re-runs the
 * reader over what it just wrote, so a row this script emits that this script would reject
 * fails the Load run loudly instead of reddening CI a week later.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = join(root, 'docs', 'perf', 'BASELINE.md');

if (!existsSync(baseline)) {
  console.error('MISSING docs/perf/BASELINE.md — the Q-17 baseline is the audit deliverable.');
  process.exit(1);
}

// `path/to.spec.ts` → `assertion name` — one or more per table cell, separated by commas.
// A cell with a path but no arrow is a promise with nothing behind it, and is rejected.
const CELL = /`([^`]+\.(?:spec|test)\.ts)`(?:\s*→\s*`([^`]+)`)?/g;

const LATENCY_HEADING = '## Latency (real stack)';
// A recorded row opens with an ISO date. `_not yet run_` does not match, and neither does the
// header or the `|---|` separator, so this is the whole emptiness test.
const RECORDED_ROW = /^\|\s*20\d\d-\d\d-\d\d\s*\|/;

/** Every `Pinned by` reference still resolves to a file and a test title that exists. */
function checkPinnedRefs(text) {
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
  return { rows, problems };
}

/*
 * A row the WRITER would have refused must not count for the READER.
 *
 * `--record` skips a scenario whose fan-out width came back 0 and says so with a
 * `::warning::` — "nothing was measured, so no baseline row". But `check()` only asked
 * whether a line starts with a date, so two hand-typed `N = 0` rows satisfied the gate as
 * "wall-clock measurements". Writer and reader disagreeing about what a valid row IS means
 * the gate can be satisfied by rows the tool itself declines to produce.
 *
 * The width lives in column 6 of the pipe table. `?` is honest — the run did not report a
 * width — and stays acceptable; `0` is the case the writer rejects, so it is rejected here.
 */
const MEASURED_WIDTH = (row) => {
  const width = row.split('|')[6]?.trim();
  return width !== '0';
};

/** The Latency section carries at least one measurement. Returns the dated rows it found. */
function latencyRows(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === LATENCY_HEADING);
  if (start === -1) return null; // section gone entirely — reported separately
  return lines.slice(start).filter((l) => RECORDED_ROW.test(l) && MEASURED_WIDTH(l));
}

function check() {
  const text = readFileSync(baseline, 'utf8');
  const { rows, problems } = checkPinnedRefs(text);

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

  const latency = latencyRows(text);
  if (latency === null) {
    console.error(`docs/perf/BASELINE.md has lost its "${LATENCY_HEADING}" section.`);
    process.exit(1);
  }
  if (latency.length === 0) {
    console.error(
      'docs/perf/BASELINE.md records no wall-clock measurement — the Latency table holds ' +
        'no dated row.\n\n' +
        'Round-trip counts say a path stopped being quadratic; they do not say it is fast\n' +
        'enough. The Load workflow measures that and writes the row itself:\n\n' +
        '  gh workflow run load.yml   (main only; the record step pushes the row)\n\n' +
        'If a row was deleted, restore it — an empty baseline is one nobody can regress against.',
    );
    process.exit(1);
  }

  console.log(
    `Performance baseline OK — ${rows} pinned hot path(s), every test present; ` +
      `${latency.length} recorded latency run(s).`,
  );
}

// --------------------------------------------------------------------------------------
// --record: turn two k6 `--summary-export` files into rows of the Latency table.

/** k6 exports Trend as {avg,min,med,max,"p(90)","p(95)"} and Rate as {passes,fails,value}. */
function ms(trend, key) {
  const v = trend?.[key];
  if (typeof v !== 'number') return null;
  // Two decimals, because that is how k6 prints them: a row here can then be diffed against
  // the run log character for character instead of "about right".
  return v.toFixed(2);
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function loadSummary(path) {
  if (!path) return null;
  if (!existsSync(path)) {
    console.error(`--record: no k6 summary at ${path}. Did the k6 step run with --summary-export?`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')).metrics || {};
}

function record(argv) {
  const runId = arg(argv, 'run') || 'local';
  const sha = (arg(argv, 'sha') || '').slice(0, 8) || 'unknown';
  const vus = arg(argv, 'vus') || '?';
  const host = arg(argv, 'host') || 'unrecorded';
  const date = (arg(argv, 'date') || new Date().toISOString()).slice(0, 10);
  const checkout = loadSummary(arg(argv, 'checkout'));
  const dashboards = loadSummary(arg(argv, 'dashboards'));

  // scenario label -> [latency trend, success rate, fan-out width trend, source summary]
  //
  // The width metric is what makes a row mean anything. Every scenario here exists to show a
  // PER-ITEM cost stopped multiplying, and a p95 with no N beside it cannot show that.
  const scenarios = [
    ['checkout', 'checkout_latency', 'checkout_success', 'checkout_cart_lines', checkout],
    [
      'franchise dashboard',
      'franchise_dashboard_latency',
      'dashboard_success',
      'franchise_depots',
      dashboards,
    ],
    [
      'performance dashboard',
      'performance_dashboard_latency',
      'dashboard_success',
      'performance_roster',
      dashboards,
    ],
  ];

  const rows = [];
  const skipped = [];
  for (const [label, trendKey, rateKey, widthKey, metrics] of scenarios) {
    if (!metrics) continue;
    const trend = metrics[trendKey];
    if (!trend) {
      // A renamed metric would otherwise be recorded as a blank row that looks like a
      // measurement. Refuse instead: the scripts and this writer must agree by name.
      console.error(`--record: k6 summary has no metric "${trendKey}" — did the script rename it?`);
      process.exit(1);
    }
    // Constant for the run, so the median IS the width. `?? null` and not `|| 0`: a missing
    // metric is unknown, which is not the same claim as zero.
    const width = metrics[widthKey]?.med ?? null;
    if (width === 0) {
      // The measured case, in both green runs this workflow has produced: the franchise
      // dashboard rendered for a SUPER_ADMIN, who owns no depots. Latency over an empty
      // fan-out is a real number about nothing, and parked in this table it reads as a
      // guarantee that the fan-out is cheap. The scenario stays green — the endpoint did
      // answer — but no row is written, so the baseline never claims what nobody measured.
      skipped.push(label);
      continue;
    }
    const ok = metrics[rateKey]?.value;
    rows.push(
      `| ${date} | ${runId} | \`${sha}\` | ${label} | ${vus} | ${width ?? '?'} | ` +
        `${metrics.iterations?.count ?? '?'} | ` +
        `${typeof ok === 'number' ? (ok * 100).toFixed(2) + '%' : '?'} | ` +
        `${ms(trend, 'med')} | ${ms(trend, 'p(90)')} | ${ms(trend, 'p(95)')} | ${host} |`,
    );
  }
  for (const label of skipped) {
    console.error(
      `::warning::${label}: fan-out width was 0 — nothing was measured, so no baseline row ` +
        `was written. See the WARN in the k6 log for which side is empty.`,
    );
  }
  if (rows.length === 0) {
    console.error('--record: every scenario had a zero-width fan-out. Nothing to record.');
    process.exit(1);
  }

  const lines = readFileSync(baseline, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === LATENCY_HEADING);
  if (start === -1) {
    console.error(`--record: no "${LATENCY_HEADING}" section to append to.`);
    process.exit(1);
  }
  // Last line of the first `|`-block after the heading: append there, chronologically.
  let last = -1;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith('|')) last = i;
    else if (last !== -1) break;
  }
  if (last === -1) {
    console.error(`--record: the "${LATENCY_HEADING}" section has no table to append to.`);
    process.exit(1);
  }
  lines.splice(last + 1, 0, ...rows);
  writeFileSync(baseline, lines.join('\n'));

  // The writer must produce something the reader accepts. Without this, a bad row format
  // ships quietly here and reddens ci.yml on someone else's unrelated PR days later.
  const written = latencyRows(readFileSync(baseline, 'utf8'));
  if (!written || written.length < rows.length) {
    console.error('--record: wrote rows the baseline check would not recognise. Not committing.');
    process.exit(1);
  }
  for (const r of rows) console.log(r);
}

if (process.argv.includes('--record')) record(process.argv.slice(2));
else check();
