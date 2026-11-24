#!/usr/bin/env node
/**
 * Audit H-39: 239 `CREATE INDEX` statements across the migrations, not one of them
 * CONCURRENTLY. A plain index build takes a lock that blocks writes to the table for as
 * long as it runs — on `orders` or `stock_movements` that is a checkout outage.
 *
 * The migrations cannot simply say CONCURRENTLY: Prisma Migrate runs a migration file's
 * statements inside a transaction, and CONCURRENTLY cannot run in one. So the split is
 * "build it concurrently first, let the migration find it already there" — see
 * scripts/create-indexes.sh.
 *
 * This check is what keeps that true for the NEXT index somebody adds: any migration
 * dated after the cutoff that creates an index must name that index in create-indexes.sh.
 * Older migrations are grandfathered — their indexes are long since built on production,
 * and rewriting history would not unbuild them.
 *
 *   node scripts/check-index-concurrency.mjs
 *
 * Exit 0 = every new index has a concurrent build path; 1 = one does not.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Migrations from this timestamp onward must route through create-indexes.sh. */
const CUTOFF = '20260804190000';

const runner = readFileSync('scripts/create-indexes.sh', 'utf8');
const problems = [];
let checked = 0;

// An index is "in create-indexes.sh" only as a row of its INDEXES='...' table. A name that
// appears anywhere else in the file (a comment, or a row appended after the closing quote)
// is not built by it, and a row outside the table is run by bash as a command: on
// 2026-11-25 such a row made the deploy refuse with a syntax error before any migration.
const runnerLines = runner.split(/\r?\n/);
const tableStart = runnerLines.indexOf("INDEXES='");
const tableEnd = runnerLines.indexOf("'", tableStart + 1);
const ROW = /^[a-z-]+\|([\w.]+)\|CREATE /;
const tableRows = new Set();
const runnerComments = runnerLines.filter((line) => /^\s*#/.test(line)).join('\n');
if (tableStart === -1 || tableEnd === -1) {
  problems.push("scripts/create-indexes.sh has no INDEXES='...' table this check can read.");
} else {
  runnerLines.forEach((line, i) => {
    const row = ROW.exec(line);
    if (!row) return;
    if (i > tableStart && i < tableEnd) tableRows.add(row[1]);
    else {
      problems.push(
        `scripts/create-indexes.sh line ${i + 1}: the row for "${row[1]}" sits outside the ` +
          `INDEXES='...' table, so it is never built and bash runs it as a command (a syntax ` +
          `error that stops every deploy). Move it inside the table.`,
      );
    }
  });
}

for (const service of readdirSync('services')) {
  const dir = join('services', service, 'prisma', 'migrations');
  if (!existsSync(dir)) continue;

  for (const migration of readdirSync(dir)) {
    const timestamp = migration.slice(0, 14);
    if (!/^\d{14}$/.test(timestamp) || timestamp < CUTOFF) continue;

    const file = join(dir, migration, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');

    for (const line of sql.split(/\r?\n/)) {
      const match = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"?([\w.]+)"?/i.exec(
        line,
      );
      if (!match || /^\s*--/.test(line)) continue;
      checked++;
      const index = match[1];
      if (/CONCURRENTLY/i.test(line)) {
        problems.push(
          `${service}/${migration}: "${index}" says CONCURRENTLY inside a migration — ` +
            `Prisma runs migrations in a transaction and this will fail at deploy time. ` +
            `Put the concurrent build in scripts/create-indexes.sh and leave a plain ` +
            `CREATE INDEX IF NOT EXISTS here.`,
        );
        continue;
      }
      // A row of the table, or a comment naming it (an index on a table its own migration
      // creates is built there, empty and instant, and the file says so in a comment).
      if (!tableRows.has(index) && !runnerComments.includes(index)) {
        problems.push(
          `${service}/${migration}: "${index}" is built by a locking CREATE INDEX and has ` +
            `no entry in scripts/create-indexes.sh — production would block writes on that ` +
            `table for the whole build (audit H-39).`,
        );
      }
    }
  }
}

// Half the rule is "the index is named in create-indexes.sh" (above); the other half is
// "that script actually runs, first". Deploy fires by itself on merge, so the ordering
// cannot live in a runbook — deploy.sh has to build concurrently BEFORE it migrates, and
// this is what keeps that call from being quietly deleted.
const deploy = readFileSync('scripts/deploy.sh', 'utf8');
const buildAt = deploy.indexOf('scripts/create-indexes.sh');
const migrateAt = deploy.indexOf('scripts/migrate-prod.sh');
if (buildAt === -1) {
  problems.push(
    'scripts/deploy.sh never runs scripts/create-indexes.sh — every new index would be ' +
      'built by the migration itself, under a write lock (audit H-39).',
  );
} else if (migrateAt !== -1 && buildAt > migrateAt) {
  problems.push(
    'scripts/deploy.sh runs create-indexes.sh AFTER migrate-prod.sh — by then the ' +
      'migration has already built the index under a write lock. Build first.',
  );
}

/**
 * The other half, learned from a deploy that refused: a migration may not ADD a column and
 * index that same column. `create-indexes.sh` runs BEFORE migrations, so the concurrent
 * build it is meant to do would hit a column that does not exist yet —
 *
 *     FAILED: ERROR: column "customerId" does not exist
 *     FAILED - refusing to let the migration build it under a lock
 *
 * - and the guard above then refuses to let the migration build it under a lock instead.
 * Both are correct; the ordering was what was wrong. A new column takes three releases: the
 * column, then its index, then the code that reads it.
 */
/**
 * Its own cutoff, later than the one above: `crm-service/20260813120000_campaign_scheduled_for`
 * already does this and is already on production. Rewriting history would not un-apply it,
 * and failing the build over a migration nobody can change teaches nothing. This guards the
 * NEXT one.
 */
const COLUMN_INDEX_CUTOFF = '20260815100000';

for (const svc of readdirSync('services')) {
  const dir = join('services', svc, 'prisma', 'migrations');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    continue;
  }
  for (const name of entries) {
    if (name < COLUMN_INDEX_CUTOFF) continue;
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    const added = [...sql.matchAll(/ADD COLUMN\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]);
    if (!added.length) continue;
    for (const m of sql.matchAll(/CREATE INDEX[^;]*/gi)) {
      const clash = added.find((c) => m[0].includes(`"${c}"`));
      if (clash)
        problems.push(
          `${svc}/${name}: adds column "${clash}" AND indexes it in the same migration - ` +
            'an index cannot be pre-built concurrently on a column that does not exist yet. ' +
            'Ship the column first and its index in the next release.',
        );
    }
  }
}

if (problems.length > 0) {
  console.error('Index-build check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Index-build check OK (${checked} index statement(s) since ${CUTOFF}).`);
