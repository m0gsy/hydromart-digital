#!/usr/bin/env node
/**
 * Every table a deploy probe queries has to exist.
 *
 * The outbox drain probe asked `order_outbox` for its whole life. No such table has ever
 * existed — it is `outbox_messages` — so the query failed, `|| echo 'unreadable'` caught it,
 * and the probe printed a word nobody parsed. Its alert never fired either, because the
 * pending count is read out of the answer and there was no answer.
 *
 * That is the worst shape a check can take: it ran on every single deploy, it never failed,
 * and it proved nothing. The probe existed precisely because "a queue that only grows looks
 * exactly like a quiet week" — and for its whole life, so did a probe that could not read it.
 *
 * A typo in a table name inside a shell string is invisible to every other gate in this
 * repo: shellcheck sees a string, the SQL never runs in CI, and Postgres only objects on
 * production at 3am. This reads the table names back out of deploy.sh and checks each one
 * against the `@@map` names Prisma actually creates.
 *
 * Exit 0 = every probed table is a table.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const DEPLOY = 'scripts/deploy.sh';
const sql = readFileSync(DEPLOY, 'utf8');

/** Every `@@map("...")` across every service schema: the tables that really get created. */
const tables = new Set();
for (const service of readdirSync('services')) {
  const schema = `services/${service}/prisma/schema.prisma`;
  if (!existsSync(schema)) continue;
  for (const m of readFileSync(schema, 'utf8').matchAll(/@@map\("([^"]+)"\)/g)) {
    tables.add(m[1]);
  }
}
if (tables.size === 0) {
  console.error('No @@map tables found — this check went blind, which is what it exists to stop.');
  process.exit(1);
}

/*
 * Tables the probes read that Prisma does not create. `information_schema` and friends are
 * Postgres' own; the rest would be a typo.
 */
const BUILT_IN = /^(pg_|information_schema\.)/;

const missing = [];
for (const line of sql.split('\n')) {
  // Prose, not SQL. The first version of this read `FROM` case-insensitively across the
  // whole file and reported `a`, `the` and `outside` as missing tables, out of comments
  // reading "from the answer". A check that cries wolf is the thing this file is about.
  if (line.trim().startsWith('#')) continue;
  // SQL here is written in uppercase; English prose is not.
  for (const m of line.matchAll(/\bFROM\s+([a-z_][a-z0-9_.]*)/g)) {
    const table = m[1].toLowerCase();
    if (BUILT_IN.test(table)) continue;
    if (!tables.has(table)) missing.push(table);
  }
}

if (missing.length > 0) {
  console.error(`${DEPLOY} queries tables that do not exist:`);
  for (const t of [...new Set(missing)]) console.error(`  - ${t}`);
  console.error('\nA probe against a missing table fails silently and proves nothing.');
  process.exit(1);
}

console.log(
  `Deploy probe check OK — every table queried in ${DEPLOY} exists ` +
    `(${tables.size} tables known across the services).`,
);
