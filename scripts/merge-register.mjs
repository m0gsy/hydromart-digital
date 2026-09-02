#!/usr/bin/env node
/**
 * Merge one branch's register row-status changes onto another version of the register.
 *
 *   node scripts/merge-register.mjs <base-file> <branch-file> [--out <file>]
 *
 * The console-audit program runs many branches in parallel, each closing DIFFERENT rows of
 * docs/CONSOLE_AUDIT_REGISTER.md. Git sees one file and conflicts; the tempting resolution
 * is `--ours` or `--theirs`, and BOTH are wrong — each silently discards every row the
 * other side closed. That is not hypothetical: resolving one rebase with `--theirs` reverted
 * CA-4-03 from SUDAH DIPERBAIKI back to TERBUKA, undoing a merged PR in the one document
 * that is supposed to be the source of truth.
 *
 * So the merge is row-keyed, not line-keyed, and it leans on the one invariant the register
 * actually has: a row only ever moves AWAY from TERBUKA. It never moves back. Therefore:
 *
 *   base TERBUKA, branch closed  -> take the branch's line (that is the branch's work)
 *   base closed,  branch TERBUKA -> take the base's line   (the branch simply predates it)
 *   both closed, differently     -> CONFLICT, reported and never guessed
 *
 * Everything that is not a register row — prose, the work-order table, the decision table —
 * is taken from the BRANCH, because that is where the branch's narrative edits live, and
 * then any row lines inside it are corrected by the rule above.
 *
 * Exit 1 on a real conflict, so a caller can stop rather than ship a wrong register.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , baseFile, branchFile] = process.argv;
if (!baseFile || !branchFile) {
  console.error('usage: merge-register.mjs <base-file> <branch-file> [--out <file>]');
  process.exit(1);
}
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;

const ROW = /^\|\s*`(CA-[0-9]+-[0-9]+)`\s*\|/;

/** Row id -> { line, status } for every table row that carries a Status cell. */
function rows(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(ROW);
    if (!m) continue;
    const cells = line.split('|').map((c) => c.trim());
    const status = cells[7] ?? '';
    if (!status) continue; // not the main table (e.g. the dead-premise table)
    map.set(m[1], { line, status });
  }
  return map;
}

const baseText = readFileSync(baseFile, 'utf8');
const branchText = readFileSync(branchFile, 'utf8');
const baseRows = rows(baseText);
const branchRows = rows(branchText);

const isOpen = (s) => s === 'TERBUKA';

let tookBase = 0;
let tookBranch = 0;
const conflicts = [];

// Walk the BRANCH text (its prose edits are the ones we want to keep) and correct any row
// the base has already moved further along.
const merged = branchText
  .split('\n')
  .map((line) => {
    const m = line.match(ROW);
    if (!m) return line;
    const id = m[1];
    const b = baseRows.get(id);
    const br = branchRows.get(id);
    if (!b || !br) return line;
    if (b.status === br.status) return line;
    if (isOpen(br.status) && !isOpen(b.status)) {
      tookBase += 1;
      return b.line; // the base closed it; the branch simply predates that
    }
    if (isOpen(b.status) && !isOpen(br.status)) {
      tookBranch += 1;
      return line; // this branch closed it
    }
    conflicts.push(`${id}: base="${b.status}" branch="${br.status}"`);
    return line;
  })
  .join('\n');

// A row present in the base but missing from the branch text would be silently dropped.
for (const id of baseRows.keys()) {
  if (!branchRows.has(id)) conflicts.push(`${id}: present in base, MISSING from branch`);
}

console.log(`rows: ${branchRows.size} | kept from base: ${tookBase} | kept from branch: ${tookBranch}`);

if (conflicts.length) {
  console.error('');
  console.error(`FAIL — ${conflicts.length} row(s) cannot be merged automatically:`);
  for (const c of conflicts) console.error(`  ${c}`);
  process.exit(1);
}

if (outFile) {
  writeFileSync(outFile, merged);
  console.log(`written: ${outFile}`);
}
