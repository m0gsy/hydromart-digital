#!/usr/bin/env node
/**
 * Every role the UAT harness mints has to be a role that exists.
 *
 * The harness minted `DEPOT_OPERATOR`, `DEPOT_MANAGER` and `DRIVER` — names from before the
 * thirteen-role rebuild. None of them are in the enum any more, so every guard refused every
 * token carrying them, and the harness reported it as the product refusing: 99 FORBIDDEN out
 * of ~146 failures in one run.
 *
 * That is invisible from the harness side. A ghost role does not throw, it does not warn, it
 * produces a perfectly ordinary 403 forty minutes into a monthly job — and it reads exactly
 * like a permissions bug in the product.
 *
 * Exit 0 = every minted role is a real one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROLE_SOURCE = 'services/auth-service/src/domain/customer/role.enum.ts';
const valid = new Set(
  [...readFileSync(ROLE_SOURCE, 'utf8').matchAll(/^\s+([A-Z_]+)\s*=\s*'([A-Z_]+)'/gm)].map(
    (m) => m[2],
  ),
);
if (valid.size === 0) {
  console.error(`No roles parsed from ${ROLE_SOURCE} — this check went blind.`);
  process.exit(1);
}

/**
 * Comment lines skipped LINE BY LINE, not by matching comment spans.
 *
 * The span version — lifted from check-money-literals.mjs — blanked the real invite line in
 * run.mjs entirely. A non-greedy `/*...*​/` match will happily swallow a huge region when a
 * stray `/*` or `*​/` appears inside a string or a regex literal somewhere above it, and
 * this file has both. A gate that silently blanks the code it is meant to read is worse
 * than no gate: it reports OK.
 *
 * Line-based is dumber and cannot do that. A role name is never written across two lines.
 */
const codeLines = (text) =>
  text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

const bad = [];
for (const file of readdirSync('.uat').filter((f) => f.endsWith('.mjs'))) {
  const path = join('.uat', file);
  const text = codeLines(readFileSync(path, 'utf8'));
  /*
   * BOTH places a role name appears, and the second one is why this check missed the worst
   * of it. The first version only read `mintToken('...')`, so `role: 'DRIVER'` sitting in a
   * staff-invite body went straight past — and that one was far more expensive, because it
   * failed SILENTLY: the invite was rejected, the id came back undefined, the token was
   * minted without a subject, and the error finally surfaced three services away as
   * "Argument `courierId` is missing" on an unrelated endpoint.
   */
  for (const pattern of [/mintToken\(\s*'([A-Z_]+)'/g, /role:\s*'([A-Z_]+)'/g]) {
    for (const m of text.matchAll(pattern)) {
      if (!valid.has(m[1])) bad.push(`${path}: ${m[1]}`);
    }
  }
}

if (bad.length > 0) {
  console.error('The UAT harness mints roles that do not exist:');
  for (const b of [...new Set(bad)]) console.error(`  - ${b}`);
  console.error(`\nValid roles: ${[...valid].sort().join(', ')}`);
  console.error('A token with an unknown role is refused by every guard, and it reads as a');
  console.error('product permissions bug rather than a harness one.');
  process.exit(1);
}
console.log(`UAT role check OK — every minted role is one of the ${valid.size} real ones.`);
