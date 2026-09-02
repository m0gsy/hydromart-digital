#!/usr/bin/env node
/**
 * Recount docs/CONSOLE_AUDIT_REGISTER.md from its own table rows, and rewrite the summary.
 *
 *   node scripts/register-tally.mjs            # print the counts
 *   node scripts/register-tally.mjs --write    # rewrite the "Per status" line to match
 *
 * The register is the loop state, and every PR in the audit program flips the Status column
 * on the rows it closes. Two things then go wrong on their own:
 *
 *   1. The hand-written summary near the top drifts from the table below it, and a summary
 *      that disagrees with its own data is worse than no summary — the next session plans
 *      against it.
 *   2. Several branches run in parallel, each closing DIFFERENT rows. The row edits merge
 *      cleanly; the one summary line conflicts every single time, and resolving it by hand
 *      is exactly the moment a number gets typed wrong.
 *
 * So the summary is derived, never authored. Run with --write after any merge.
 *
 * Exit 1 when the file's summary disagrees with its rows, so CI could gate on it later.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = `${ROOT}docs/CONSOLE_AUDIT_REGISTER.md`;

const src = readFileSync(FILE, 'utf8');

/**
 * Only rows of the register's own tables: a line starting with `| ` whose first cell is a
 * backticked CA-id. The work-order table and the decision table are skipped by that shape,
 * which is the point — they carry no Status column.
 */
const counts = new Map();
let rows = 0;
for (const line of src.split('\n')) {
  const m = line.match(/^\|\s*`(CA-[0-9]+-[0-9]+)`\s*\|/);
  if (!m) continue;
  const cells = line.split('|').map((c) => c.trim());
  // ID | Bagian | Tingkat | Judul | file:baris | Kelas akar | Status | Bukti | PR
  const status = (cells[7] ?? '').replace(/\s*\(PR.*$/, '').replace(/\s+DARI\s+CA-.*$/i, '');
  if (!status) continue;
  rows += 1;
  counts.set(status, (counts.get(status) ?? 0) + 1);
}

const order = ['TERBUKA', 'SUDAH DIPERBAIKI', 'DUPLIKAT', 'DITOLAK', 'KEPUTUSAN'];
const parts = order
  .filter((k) => counts.has(k) || k === 'KEPUTUSAN')
  .map((k) => `\`${k}\` ${counts.get(k) ?? 0}`);
for (const [k, v] of counts) if (!order.includes(k)) parts.push(`\`${k}\` ${v}`);

const line = parts.join(' · ');
console.log(`register rows with a Status: ${rows}`);
console.log(line);

const SUMMARY = /^`TERBUKA` \d+ · .*$/m;
const current = src.match(SUMMARY)?.[0];

if (process.argv.includes('--write')) {
  if (!current) {
    console.error('could not find the summary line to rewrite');
    process.exit(1);
  }
  // Keep whatever trailing prose the line carried after the counts — it explains the
  // KEPUTUSAN column and is not derivable.
  const tail = current.replace(/^`TERBUKA` \d+ · [^—]*/, '');
  writeFileSync(FILE, src.replace(SUMMARY, line + (tail.startsWith('—') ? ' ' + tail : '')));
  console.log('summary rewritten');
  process.exit(0);
}

if (current && !current.startsWith(line.split(' — ')[0])) {
  console.error('');
  console.error('FAIL — the summary disagrees with the rows it summarises:');
  console.error(`  summary: ${current}`);
  console.error(`  rows:    ${line}`);
  console.error('Run: node scripts/register-tally.mjs --write');
  process.exit(1);
}
