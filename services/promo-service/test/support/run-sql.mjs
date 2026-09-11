// Runs captured SQL against a real Postgres (PGlite) built from a service's migrations.
//
// A separate Node process on purpose: PGlite loads its WASM bundle with a dynamic import(),
// which Jest's VM context refuses without --experimental-vm-modules. The spec captures the
// exact SQL text + values the repository sends, and hands them here over stdin.
//
// stdin:  { migrations: string, seed: {text, values}[], queries: {text, values}[] }
// stdout: [{ ok: true, rows } | { ok: false, error }] — one per query, in order.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();

for (const dir of readdirSync(input.migrations).filter((d) => /^\d{4}_/.test(d)).sort()) {
  await db.exec(readFileSync(join(input.migrations, dir, 'migration.sql'), 'utf8'));
}
for (const s of input.seed) await db.query(s.text, s.values);

const results = [];
for (const q of input.queries) {
  try {
    const r = await db.query(q.text, q.values);
    results.push({ ok: true, rows: r.rows });
  } catch (error) {
    results.push({ ok: false, error: error.message });
  }
}
await db.close();
process.stdout.write(JSON.stringify(results, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
