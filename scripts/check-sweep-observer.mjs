#!/usr/bin/env node
/**
 * Every scheduled sweep must have somewhere to report, and something that reads it.
 *
 *   node scripts/check-sweep-observer.mjs
 *
 * CA-5-01. Seventeen crontab lines sweep the money and PDP paths, and until this gate
 * existed not one of them had a screen. `sweep.sh` does record every tick — into empty
 * marker files under /var/run/sweep INSIDE the scheduler container, which no console reads
 * and no operator opens. The container healthcheck reads exactly one of them,
 * `last-success`, and answers a single yes/no for all seventeen jobs at once: so a sweep
 * that has never run once is indistinguishable from one that ran a minute ago, as long as
 * some OTHER sweep succeeded recently.
 *
 * Measured on the dev box the day this was written: FailingStreak 1472, every sweep failing
 * for ~25 hours, and two jobs — subscriptions/process-due and webhooks/deliveries/process —
 * with no marker file of EITHER kind, meaning they had not run at all. Learning any of that
 * took `docker inspect`.
 *
 * Two things are asserted, and they are deliberately in one script because they are two
 * halves of one contract that ship in two releases (the table must exist in production one
 * release before any code reads it):
 *
 *   1. SCHEMA   `sweep_runs` is declared in BOTH the migration SQL and the Prisma model,
 *               with the same column set. Half of a table is how a service boots fine in
 *               CI — whose database is empty — and throws on the first write in production.
 *
 *   2. COVERAGE every crontab sweep is a job the observer knows about, and the observer
 *               invents no jobs that no longer have a crontab line. Skipped, loudly, until
 *               the reader ships: a gate that cannot yet be satisfied is a gate people
 *               learn to ignore.
 *
 * Exit 0 = the observer covers the schedule; 1 = it does not.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: a URL percent-encodes, so a checkout under a path with a
// space in it resolves to a directory that does not exist. The self-check runs in one.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CRONTAB = join(ROOT, 'scripts/scheduler/crontab');
const SCHEMA = join(ROOT, 'services/admin-service/prisma/schema.prisma');
const MIGRATION = join(
  ROOT,
  'services/admin-service/prisma/migrations/20260902090000_sweep_run/migration.sql',
);
// The job registry the reader serves from. Absent until the reading half ships — see the
// COVERAGE note above.
const REGISTRY = join(ROOT, 'services/admin-service/src/domain/sweep-schedule.ts');

/** `sh /scripts/sweep.sh <path> [host:port]` — the only shape crond invokes. */
function scheduledSweeps() {
  const out = [];
  for (const [i, line] of readFileSync(CRONTAB, 'utf8').split('\n').entries()) {
    if (line.trimStart().startsWith('#')) continue;
    const m = line.match(/sweep\.sh\s+(\S+)(?:\s+(\S+))?\s*$/);
    if (!m) continue;
    out.push({ line: i + 1, path: m[1], host: m[2] ?? 'order:3004' });
  }
  return out;
}

/** Column names inside `CREATE TABLE "sweep_runs" (...)`, in declaration order. */
function migrationColumns() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?"sweep_runs" \(([\s\S]*?)\n\);/)?.[1];
  if (!body) return null;
  return body
    .split('\n')
    .map((l) => l.trim().match(/^"([A-Za-z0-9_]+)"\s+[A-Z]/)?.[1])
    .filter(Boolean);
}

/** Field names inside `model SweepRun { ... }`, comments and attributes stripped. */
function modelColumns() {
  const src = readFileSync(SCHEMA, 'utf8');
  const body = src.match(/\nmodel SweepRun \{([\s\S]*?)\n\}/)?.[1];
  if (!body) return null;
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('///') && !l.startsWith('@@'))
    .map((l) => l.match(/^([A-Za-z][A-Za-z0-9_]*)\s+\S/)?.[1])
    .filter(Boolean);
}

const sweeps = scheduledSweeps();
let failed = 0;

console.log(`sweep observer — ${sweeps.length} scheduled sweep(s) in scripts/scheduler/crontab`);
console.log('');

// A check that passes on no input proves nothing, and "the crontab stopped scheduling
// anything" is itself the outage this gate is about.
if (sweeps.length === 0) {
  console.error('  X no sweeps are scheduled at all — refusing to pass vacuously');
  failed += 1;
}

// --- 1. schema ------------------------------------------------------------------------
const inSql = migrationColumns();
const inModel = modelColumns();

if (!inSql) {
  console.error('  X sweep_runs has no CREATE TABLE in 20260902090000_sweep_run/migration.sql');
  failed += 1;
}
if (!inModel) {
  console.error('  X sweep_runs has no `model SweepRun` in admin-service/prisma/schema.prisma');
  failed += 1;
}
if (inSql && inModel) {
  const onlySql = inSql.filter((c) => !inModel.includes(c));
  const onlyModel = inModel.filter((c) => !inSql.includes(c));
  if (onlySql.length || onlyModel.length) {
    console.error('  X sweep_runs has drifted between its migration and its Prisma model:');
    if (onlySql.length) console.error(`      SQL only:   ${onlySql.join(', ')}`);
    if (onlyModel.length) console.error(`      model only: ${onlyModel.join(', ')}`);
    console.error(
      '      CI runs against an EMPTY database, so this drift is invisible until the ' +
        'first write in production.',
    );
    failed += 1;
  } else {
    console.log(`  . schema: sweep_runs agrees across migration and model (${inSql.length} columns)`);
  }
}

// --- 2. coverage ----------------------------------------------------------------------
if (!existsSync(REGISTRY)) {
  console.log('  - coverage: SKIPPED — the reading half has not shipped yet');
  console.log(`      (this check turns on when ${REGISTRY.slice(ROOT.length)} exists)`);
} else {
  const src = readFileSync(REGISTRY, 'utf8');
  const known = [...src.matchAll(/job:\s*'([^']+)'/g)].map((m) => m[1]);
  for (const sweep of sweeps) {
    if (!known.includes(sweep.path)) {
      console.error(
        `  X crontab:${sweep.line} ${sweep.path} is scheduled but absent from the observer's ` +
          'job list — it would run unwatched, which is the whole defect this closes',
      );
      failed += 1;
    }
  }
  const scheduled = new Set(sweeps.map((s) => s.path));
  for (const job of known) {
    if (!scheduled.has(job)) {
      console.error(
        `  X the observer lists "${job}", which no crontab line schedules — it would show ` +
          'as permanently overdue and train people to ignore the screen',
      );
      failed += 1;
    }
  }
  if (failed === 0) console.log(`  . coverage: all ${sweeps.length} scheduled sweeps are watched`);
}

console.log('');
if (failed > 0) {
  console.error(`FAIL — ${failed} problem(s) with the sweep observer.`);
  process.exit(1);
}
console.log('sweep observer OK.');
