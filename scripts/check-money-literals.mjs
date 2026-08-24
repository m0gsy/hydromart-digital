#!/usr/bin/env node
/**
 * A business number written into a screen is a number nobody can change without a deploy —
 * and, worse, one that silently disagrees with the server. PR #60 found two live: a
 * subscription discount the web priced at one rate while promo-service used another, and a
 * points message that promised a rate loyalty-service had stopped granting. Both looked
 * perfectly reasonable in review, because a literal in a `.tsx` reads like a constant.
 *
 * This is the gate for the next one. It does not flag every number — a `max-w-[1216px]`, a
 * 15-second poll and a `placeholder="20000"` are not business rules — it flags numbers that
 * are DOING MONEY: arithmetic or a comparison against a money-named value, an amount handed
 * to a currency formatter, and rupiah written into copy.
 *
 *   node scripts/check-money-literals.mjs            # check
 *   node scripts/check-money-literals.mjs --update   # re-record the allowlist
 *
 * The allowlist carries the ones that are genuinely presentation (a `/ 100` percent
 * conversion the server already agreed on, a chart's axis step). It may shrink; growing it
 * is a deliberate, reviewable act — same contract as the endpoint allowlist next door.
 *
 * Exit 0 = no unallowed money literal; 1 = one is there.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Read from disk rather than listed: a service added later is inside the gate on the day it
// is added, which a hand-kept list would not have been.
const ROOTS = [
  'apps/web/src',
  ...readdirSync('services', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join('services', d.name, 'src'))
    .filter((dir) => existsSync(dir)),
];
const ALLOWLIST = 'scripts/money-literal-allowlist.json';

/** Names that mean "this is money, a rate or a points balance" in this codebase. */
const MONEY =
  '(?:[a-zA-Z]*(?:total|amount|price|harga|fee|biaya|subtotal|deposit|saldo|balance|salary|gaji|komisi|commission|bonus|denda|potongan|discount|diskon|refund|payout|cash|tunai|nominal|threshold|rate|tarif|poin|points|revenue|omzet|profit|margin)[a-zA-Z]*)';
const NUM = '(?:\\d[\\d_]*(?:\\.\\d+)?)';

/**
 * 0, 1 and 2 are structure, not policy (an index, a guard, a `toFixed(2)`), and 100 is the
 * percent conversion every one of these screens does on a rate the server already sent.
 */
const HARMLESS = new Set(['0', '1', '2', '100', '1.0', '0.0']);

const RULES = [
  {
    why: 'money value combined with a literal',
    re: new RegExp(`\\b${MONEY}\\s*(?:[*/+-]|[<>]=?|={2,3})\\s*(${NUM})\\b`, 'gi'),
  },
  {
    why: 'literal combined with a money value',
    re: new RegExp(`(?<![\\w.])(${NUM})\\s*[*/+-]\\s*${MONEY}\\b`, 'gi'),
  },
  {
    why: 'literal amount handed to a currency formatter',
    re: new RegExp(`\\bformat(?:IDR|Currency|Rupiah|Money)\\s*\\(\\s*(${NUM})\\b`, 'gi'),
  },
  {
    // `Rp20.000` in copy is the same drift with no arithmetic around it: the number is in
    // the sentence, and the sentence outlives whatever set it.
    why: 'rupiah written into copy',
    // Anywhere, not only inside quotes: the copy that carries a price is as often JSX text
    // as it is a string, and the drift is identical either way.
    re: /(?<![\w-])(Rp\.?\s?\d[\d.,]*)/g,
  },
];

/**
 * K2.11: `.ts` as well as `.tsx`, and every service, not only the web client.
 *
 * This gate only ever read .tsx under apps/web/src. So the pricing module, the membership
 * module, the formatter, every dictionary — all `.ts` — and all eighteen services were
 * outside it, which is a money gate that cannot see the money code. Widening it found 19
 * occurrences the narrow version could not reach.
 *
 * Worth writing down, because it corrects the plan that asked for this: the pricing,
 * membership and format modules came back CLEAN. Every finding is either a rupiah amount
 * written into copy (17, in the dictionaries) or a Swagger example in a DTO (2). No service
 * does arithmetic against a money literal.
 */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Comments blanked, newlines kept so line numbers still point at the source. A comment
 * ABOUT a number is not the number doing anything — the loyalty screen carries a note
 * explaining the very drift this gate exists for, and reporting that note as a finding is
 * how a gate teaches people to run --update without reading it.
 */
const withoutComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, head) => head + ' '.repeat(m.length - head.length));

const findings = [];
for (const file of ROOTS.flatMap((r) => sourceFiles(r))) {
  const text = withoutComments(readFileSync(file, 'utf8'));
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      if (HARMLESS.has(m[1])) continue;
      findings.push({
        id: `${file.replace(/\\/g, '/')}:${lineOf(text, m.index)} ${m[0].trim()}`,
        why: rule.why,
      });
    }
  }
}

// `{ "<file>:<line> <code>": "why this one is presentation" }` — a reason per entry, because
// "somebody allowlisted it once" is not an answer anyone can review.
const recorded = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : {};

if (process.argv.includes('--update')) {
  const next = {};
  for (const f of [...findings].sort((a, b) => a.id.localeCompare(b.id)))
    next[f.id] = recorded[f.id] ?? f.why;
  writeFileSync(ALLOWLIST, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Recorded ${findings.length} money literal(s). Say why for each new one.`);
  process.exit(0);
}

const allowed = new Set(Object.keys(recorded));
const failures = findings.filter((f) => !allowed.has(f.id));

if (failures.length > 0) {
  console.error('Business numbers written into the web client:');
  for (const f of failures) console.error(`  - ${f.id}\n      ${f.why}`);
  console.error('\nRead the number from the API or a per-depot setting instead. If it really is');
  console.error('presentation, run with --update and say why in the PR.');
  process.exit(1);
}

const stale = [...allowed].filter((id) => !findings.some((f) => f.id === id));
console.log(
  `Money literal check OK — ${findings.length} allowlisted occurrence(s) across ${ROOTS.flatMap((r) => sourceFiles(r)).length} source file(s) in ${ROOTS.length} root(s).`,
);
if (stale.length > 0) {
  console.log('Allowlist entries that no longer exist — run with --update to drop them:');
  for (const id of stale) console.log(`  - ${id}`);
}
