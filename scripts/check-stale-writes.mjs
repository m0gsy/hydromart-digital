#!/usr/bin/env node
/**
 * CA-2-53 — console writes that cannot tell an edit from an overwrite.
 *
 *   node scripts/check-stale-writes.mjs           # gate: fail if the count grew
 *   node scripts/check-stale-writes.mjs --list    # show every remaining site
 *   node scripts/check-stale-writes.mjs --write   # record the current count
 *
 * Every console form reads a record, holds it while somebody types, and PUTs the whole
 * thing back. Nothing in that round trip says WHICH version was read, so the server cannot
 * refuse a save built on a copy that is already out of date — the second admin's save
 * simply erases the first's, and neither is told.
 *
 * The fix is a field: send back the `updatedAt` you were shown, and the server compares
 * (`assertFresh` in @hydromart/platform). This counts the writes that still do not, and
 * ratchets: the number may fall, never rise.
 *
 * WHAT IT DOES NOT CLAIM. Most of these cannot be fixed by editing the form alone —
 * measured 2026-09-09, of 61 blind writes only 6 read a record whose type carries an
 * `updatedAt` at all. The rest need the endpoint to start returning one first, which is a
 * schema and contract change per service, not a console change. So this gate holds the
 * line while that happens; it does not pretend the line is the finish.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src/app';
const BASELINE = 'scripts/stale-writes-baseline.json';
/** The two consoles and the HR console — the screens staff share. */
const AREAS = ['hq/', 'dashboard/', 'hr/'];

/** Prose naming a call is not a call — every source scan in this repo has learnt this. */
const code = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

const sites = [];
for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1);
  if (!AREAS.some((a) => rel.startsWith(a))) continue;
  const src = code(readFileSync(file, 'utf8'));
  const lines = src.split(/\r?\n/);
  for (const m of src.matchAll(/api\.(put|patch)\s*[<(]/g)) {
    const line = src.slice(0, m.index).split(/\r?\n/).length;
    /*
     * The body of the call, near enough: a write's payload is written directly under it,
     * and no call in this app spans more than a dozen lines. Reading the real expression
     * would mean parsing TSX to find out whether one word is present.
     */
    const body = lines.slice(line - 1, line + 14).join('\n');
    if (body.includes('seenUpdatedAt')) continue;
    sites.push({ file: `${ROOT}/${rel}`, line, text: lines[line - 1].trim().slice(0, 90) });
  }
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of sites) console.log(`${s.file}:${s.line}  ${s.text}`);
  console.log(`\n${sites.length} blind write(s).`);
  process.exit(0);
}

if (args.includes('--write')) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ count: sites.length, files: [...new Set(sites.map((s) => s.file))].sort() }, null, 2)}\n`,
  );
  console.log(`stale-writes: recorded ${sites.length} remaining site(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { count: 0 };

if (sites.length > baseline.count) {
  console.error(
    `stale-writes: ${sites.length} console write(s) that cannot tell an edit from an overwrite, baseline ${baseline.count}.`,
  );
  const known = new Set(baseline.files ?? []);
  const fresh = sites.filter((s) => !known.has(s.file));
  if (fresh.length) {
    console.error('\n  new file(s) carrying one:');
    for (const s of fresh.slice(0, 20)) console.error(`    ${s.file}:${s.line}  ${s.text}`);
  }
  console.error(
    '\n  Send back the `updatedAt` the form was shown, as `seenUpdatedAt`, and refuse the\n' +
      '  write on the server with `assertFresh` from @hydromart/platform. If the record has\n' +
      '  no `updatedAt` yet, the endpoint has to start returning one — that is the work, and\n' +
      '  it is not optional just because it is bigger than the form.',
  );
  process.exit(1);
}

if (sites.length < baseline.count) {
  console.log(
    `stale-writes: ${sites.length} remaining (was ${baseline.count}) — run --write to lock the gain in.`,
  );
  process.exit(0);
}

console.log(`stale-writes: ${sites.length} remaining, none new.`);
