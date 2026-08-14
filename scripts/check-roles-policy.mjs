#!/usr/bin/env node
/**
 * `@Roles(...)` may name a FIXED SET, never a policy.
 *
 * `decorators.ts` draws the line: `@Roles` is for "a fixed set that is not a policy
 * decision" — a self-service route only a CUSTOMER can call, the seven courier routes only
 * STAFF_DEPOT reaches, a cron sweep behind SUPER_ADMIN, the franchise owner's own portal.
 * Everything else — who may write the catalogue, read money reports, adjust points, set
 * tax — is a policy, and a policy belongs in `@hydromart/access` where `effectiveMatrix()`
 * can show it and a SUPER_ADMIN can retune it at runtime.
 *
 * PR-7 moved 38 decorators across. This keeps them there: a NEW multi-role tuple, or a
 * spread of a locally-declared role constant, fails the build.
 *
 *   node scripts/check-roles-policy.mjs
 *
 * Forcing the fixed sets into the matrix would be worse, not better: a SUPER_ADMIN could
 * then hand a CUSTOMER the cron sweep. That is why this check permits them by name rather
 * than demanding zero.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The four fixed sets, each allowed alone and for the reason written beside it. */
const FIXED = new Set([
  'Role.CUSTOMER', // self-service: the caller acting on their own account
  'Role.STAFF_DEPOT', // the courier app's own routes
  'Role.SUPER_ADMIN', // cron/sweep/maintenance, never a delegated power
  'Role.FRANCHISE_OWNER', // the owner's own portal
]);

function controllers(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) controllers(p, out);
    else if (p.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const findings = [];
for (const service of readdirSync('services')) {
  const src = join('services', service, 'src');
  let files;
  try {
    files = controllers(src);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // Comments quote `@Roles(...)` when explaining themselves; only real decorators count.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/@Roles\(([^)]*)\)/g)) {
      const arg = m[1].replace(/\s+/g, ' ').trim();
      if (FIXED.has(arg)) continue;
      const line = code.slice(0, m.index).split('\n').length;
      findings.push(
        `${file}:${line}  @Roles(${arg}) — a set of roles chosen per route is a policy. ` +
          'Add a capability to @hydromart/access and use @Can().',
      );
    }
  }
}

if (findings.length) {
  console.error(`@Roles policy check FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('\nThe four sets that may stay are listed at the top of this script.');
  process.exit(1);
}
console.log('@Roles policy check OK — every remaining @Roles names one fixed, non-policy set.');
