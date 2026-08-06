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
      if (!runner.includes(index)) {
        problems.push(
          `${service}/${migration}: "${index}" is built by a locking CREATE INDEX and has ` +
            `no entry in scripts/create-indexes.sh — production would block writes on that ` +
            `table for the whole build (audit H-39).`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error('Index-build check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Index-build check OK (${checked} index statement(s) since ${CUTOFF}).`);
