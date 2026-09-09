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


/**
 * A one-tap ACTION, not a form — and the difference is the whole rule.
 *
 * Last-write-wins only loses work when there is work to lose. "Approve", "resolve",
 * "deactivate", "assign to this depot" each write one decision the server already guards by
 * status, and two people tapping the same one produce the same row. A form carries a record
 * somebody typed: name, price, hours, bank account. That is what a second save erases.
 *
 * Read off the payload, because that is what the shape actually is: an inline object with
 * at most two properties (or an empty body) is a decision; anything else — a variable
 * holding a built payload, a literal with three or more fields — is a record.
 */
function isAction(call) {
  // A verb with no payload at all: `api.patch(url, undefined, true)` / `..., {}, true)`.
  if (/,\s*(undefined|\{\s*\})\s*,/.test(call)) return true;
  const m = call.match(/\{[\s\S]*\}/);
  // No literal in sight means the payload was built elsewhere and handed in by name —
  // `body`, `payload`, `parsed.value`. That is a record somebody typed, not a decision.
  if (!m) return false;
  // A spread means the same thing: assembled elsewhere.
  if (/\.\.\./.test(m[0])) return false;
  const keys = m[0].match(/[{,]\s*[a-zA-Z][a-zA-Z0-9]*\s*:/g) ?? [];
  return keys.length <= 2;
}

/** The call's own text, read by counting parentheses rather than guessing a line window. */
function callText(src, start) {
  let depth = 0;
  for (let i = src.indexOf('(', start); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start, start + 600);
}

const sites = [];
for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1);
  if (!AREAS.some((a) => rel.startsWith(a))) continue;
  const raw = readFileSync(file, 'utf8');
  const src = code(raw);
  /*
   * The exemption marker is read from the RAW source, because `code()` strips comments —
   * and a marker the scanner deletes before looking for it can never be found. That cost a
   * run: the gate reported a site whose reason was written directly above it.
   */
  const rawLines = raw.split(/\r?\n/);
  const lines = src.split(/\r?\n/);
  for (const m of src.matchAll(/api\.(put|patch)\s*[<(]/g)) {
    const line = src.slice(0, m.index).split(/\r?\n/).length;
    /*
     * The body of the call, near enough: a write's payload is written directly under it,
     * and no call in this app spans more than a dozen lines. Reading the real expression
     * would mean parsing TSX to find out whether one word is present.
     */
    const call = callText(src, m.index);
    if (call.includes('seenUpdatedAt')) continue;
    // An explicit, reasoned exemption, written where the call is.
    // Eight lines of lookback: a reason worth writing rarely fits on one.
    /*
     * Line numbers come from the STRIPPED source, and stripping block comments collapses
     * lines — so they cannot index the raw file. Anchor on the call's own text instead:
     * find where this statement sits in the raw source and read upwards from there.
     */
    const anchorText = lines[line - 1].trim();
    const rawAt = anchorText ? raw.indexOf(anchorText) : -1;
    if (rawAt >= 0) {
      const before = raw.slice(Math.max(0, rawAt - 900), rawAt);
      if (/stale-write-ok:/.test(before)) continue;
    }
    if (isAction(call)) continue;
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
