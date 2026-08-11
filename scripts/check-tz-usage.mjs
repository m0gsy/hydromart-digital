#!/usr/bin/env node
// Fails the build on the two ways this repo has kept cutting time in the wrong zone (C4).
//
//   node scripts/check-tz-usage.mjs [path...]
//
// 1. `toISOString().slice(0, 10)` / `.slice(0, 7)` as a PERIOD KEY. Those are the UTC day
//    and the UTC month. Every screen and every report in this platform reckons in WIB, so
//    a UTC key is wrong for the first seven hours of every day: an order placed at 01:00
//    lands on yesterday, a payslip opened at 06:00 on the 1st reads last month.
//
// 2. `date_trunc(...)` in raw SQL with no `AT TIME ZONE` in the same statement. The columns
//    are naive timestamps holding UTC, so a bare date_trunc cuts the day at 07:00 WIB. The
//    correct form is two hops: `AT TIME ZONE 'UTC' AT TIME ZONE ${tz}`.
//
// Both are legitimate in one narrow case: a value that is ALREADY a local date stored as
// UTC-midnight (Prisma `@db.Date`). Say so on the line, or the line above it:
//
//   // tz-ok: workDate is @db.Date — the UTC slice IS the local day
//
// The reason is required. `tz-ok` alone does not silence it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const DEFAULT_ROOTS = ['services', 'apps/web/src', 'packages'];
// `test` is skipped whole: a fixture may deliberately build a UTC key to prove the
// production path does NOT (see order-service/test/support/fakes.ts).
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'generated',
  '.next',
  'coverage',
  'build',
  'test',
  'e2e-static',
]);
const EXT = /\.(ts|tsx|mjs)$/;

/**
 * Known-pending violations, with the item that removes them. They are LISTED, not ignored:
 * a new one anywhere fails immediately, and this list may only ever shrink.
 *
 * apps/web is deliberately here — the frontend day keys are plan item 4.9 (`todayWib()`),
 * and splitting that across two PRs would leave the console reading two different days.
 */
const PENDING = [{ prefix: `apps${sep}web${sep}src`, owner: 'plan item 4.9 (todayWib/monthWib)' }];

const PERIOD_SLICE = /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*(10|7)\s*\)/;
const DATE_TRUNC = /date_trunc\s*\(/i;
const TZ_OK = /tz-ok:\s*\S/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXT.test(name) && !/\.(spec|test)\.[tm]sx?$/.test(name)) yield full;
  }
}

/** The SQL statement a `date_trunc` sits in: the template literal around it. */
function templateAround(text, index) {
  const start = text.lastIndexOf('`', index);
  const end = text.indexOf('`', index);
  if (start === -1 || end === -1) return text.slice(Math.max(0, index - 400), index + 400);
  return text.slice(start, end + 1);
}

const violations = [];
const pending = [];

for (const rootDir of process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS) {
  // `resolve`, not `join`: an absolute path (the self-check's fixtures) must be taken as
  // given rather than glued onto the repo root.
  for (const file of walk(resolve(ROOT, rootDir))) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, 'utf8');
    if (!PERIOD_SLICE.test(text) && !DATE_TRUNC.test(text)) continue;
    const lines = text.split(/\r?\n/);

    lines.forEach((line, i) => {
      // A line that only TALKS about the pattern (this file's own docs, a code comment
      // explaining the fix) is not a use of it.
      if (/^\s*(\/\/|\*|--)/.test(line)) return;
      // The reason may sit anywhere in the comment block directly above — a good reason is
      // often two lines long, and forcing it onto one would make it worse.
      let excused = TZ_OK.test(line);
      // Walk up through the comment block above — and through the earlier lines of the same
      // statement, since the slice is often on a continuation line. Bounded, so a reason
      // twenty lines away never silences anything.
      for (let k = i - 1; k >= 0 && k >= i - 6 && !excused; k--) {
        const above = lines[k];
        excused = TZ_OK.test(above);
        if (!/^\s*(\/\/|\*|\/\*)/.test(above) && /[;{}]\s*$/.test(above)) break;
      }
      let why = null;
      if (PERIOD_SLICE.test(line)) why = 'UTC period key from toISOString().slice';
      else if (DATE_TRUNC.test(line)) {
        const stmt = templateAround(text, text.indexOf(line));
        if (!/AT TIME ZONE/i.test(stmt)) why = 'date_trunc with no AT TIME ZONE';
      }
      if (!why || excused) return;
      const hit = { file: rel, line: i + 1, why, text: line.trim().slice(0, 100) };
      const owner = PENDING.find((p) => rel.startsWith(p.prefix))?.owner;
      (owner ? pending : violations).push(owner ? { ...hit, owner } : hit);
    });
  }
}

// Listed, never silent: a reader of this output learns the debt exists and who owns it.
if (pending.length > 0) {
  console.log(`tz-usage: ${pending.length} known-pending site(s), owned by:`);
  for (const owner of new Set(pending.map((p) => p.owner))) {
    console.log(`  - ${owner}: ${pending.filter((p) => p.owner === owner).length} site(s)`);
  }
}

if (violations.length > 0) {
  console.error(`\ntz-usage: ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.why}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    '\nCut the period in the business zone (localDayKey/localMonthKey from @hydromart/platform),',
  );
  console.error("or, in SQL, `AT TIME ZONE 'UTC' AT TIME ZONE ${tz}`.");
  console.error('If the value is already a local date stored as UTC-midnight, say so:');
  console.error('  // tz-ok: <why this one is already local>\n');
  process.exit(1);
}

console.log('tz-usage: no new UTC period keys.');
