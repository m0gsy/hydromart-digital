#!/usr/bin/env node
/**
 * Depot-scope gate for BY-ID routes.
 *
 * `DepotScopeGuard` (packages/platform) closes the enumeration vector: any request carrying
 * a `depotId`/`depotIds` in query, body or route params must name a depot the caller is
 * responsible for. Its own class comment says what it cannot do:
 *
 *   "By-id endpoints (GET/PATCH /:id) don't carry a depotId, so a locked role could still
 *    reach a row of another depot IF it already knows that row's UUID."
 *
 * Nothing enforced the second half. The console audit found two Kritis IDORs sitting in
 * exactly that gap — a manager rewriting any depot's bank account through `PATCH /depots/:id`,
 * and a courier reading any depot's payment history through `GET payments/for-order/:orderId`
 * — and measured the shape of the class around them: 165 by-id parameters, 44 of 57
 * controllers that never mention `assertDepotAccess` or `depotScopeIds`.
 *
 * This script is the missing half, as a ratchet rather than a wall. It enumerates every
 * route that
 *
 *   1. takes a path parameter that is NOT `depotId`/`depotIds` (so the guard is blind to it),
 *   2. is reachable by a depot-scoped role — `@Can(<cap>)` whose capability list contains one
 *      of STAFF_DEPOT / KEPALA_DEPOT / ASSISTANT_SUPERVISOR / SUPERVISOR / MANAGER, or no
 *      `@Can` at all on a route that is neither `@Public()` nor internal-key guarded,
 *
 * and reports the ones where neither the controller nor the service method it forwards to
 * mentions a depot-scope assertion. The count may only go DOWN: the baseline is checked in
 * next to this file, and a run that finds MORE than the baseline fails.
 *
 * Two things it deliberately does not do:
 *
 * - It does not claim every route it lists is a hole. Plenty are customer-owned rows
 *   (`cart/items/:productId`), network-level rows (`products/:id`) or driver-owned rows,
 *   guarded by ownership rather than by depot. The baseline records them so the number is
 *   honest, and each one that gets reviewed and fixed makes the number smaller.
 * - It does not parse TypeScript. It reads decorators and method bodies as text, which is
 *   how every other gate in `scripts/` works and is enough to keep the count from growing.
 *
 * Usage:  node scripts/check-depot-scope.mjs [--write]
 *         --write updates the baseline (use it only when the number goes DOWN).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'depot-scope-baseline.json');
const SCOPED_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
];
const GUARD = /assertDepotAccess|assertDepotOwnership|depotScopeIds|depotWhere|assertOrderDepotAccess/;

/** Capability -> roles, read straight out of the one map both server and console use. */
function capabilities() {
  const src = readFileSync(join(ROOT, 'packages/access/src/index.ts'), 'utf8');
  const body = src.slice(src.indexOf('CAPABILITIES'));
  const out = {};
  for (const m of body.matchAll(/^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*:\s*\[([\s\S]*?)\],?\s*$/gm)) {
    const roles = [...m[2].matchAll(/'([A-Z][A-Z_]+)'/g)].map((r) => r[1]);
    if (roles.length) out[m[1]] = roles;
  }
  return out;
}

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (/node_modules|dist|coverage|generated|migrations/.test(p)) continue;
      walk(p, filter, out);
    } else if (filter(p)) out.push(p);
  }
  return out;
}

/**
 * The body of `name` in `src`, from its signature to the next member at the same indent.
 * Decorators are NOT part of it — a route decorator's own `})` used to end the body one line
 * in, which read every guarded handler as unguarded.
 */
function methodBody(src, name) {
  const re = new RegExp(
    `^ {2}(?:private |public |protected )?(?:async )?${name}\\s*[(<]`,
    'm',
  );
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  const nxt = /^ {2}(?:@|(?:private |public |protected |readonly )?(?:async )?[A-Za-z_][A-Za-z0-9_]*\s*[(<])/m.exec(rest);
  return rest.slice(0, nxt ? nxt.index : rest.length);
}

/**
 * Handler source for a route decorator at `line`.
 *
 * The decorator stack has to be skipped first, comments included: `@ApiOperation({ … })`
 * opens and closes a brace on one line, so a body that starts at the decorators ends on the
 * decorator and every guarded handler reads as unguarded. Start at the method SIGNATURE —
 * the first line at this indent that is not a decorator, a comment or a closer.
 */
function handlerAt(lines, line) {
  const SIGNATURE = /^ {2}(?:private |public |protected )?(?:async )?[A-Za-z_][A-Za-z0-9_]*\s*[(<]/;
  let i = line;
  while (i < lines.length && i < line + 40 && !SIGNATURE.test(lines[i])) i++;
  let body = '';
  let depth = 0;
  let started = false;
  for (; i < lines.length && i < line + 130; i++) {
    body += lines[i] + '\n';
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
    }
    if (started && depth <= 0) break;
  }
  return body;
}

const CAPS = capabilities();
const serviceCache = new Map();
function servicesOf(svcDir) {
  if (!serviceCache.has(svcDir)) {
    serviceCache.set(
      svcDir,
      walk(svcDir, (p) => p.endsWith('.service.ts') && !p.endsWith('.spec.ts')).map((p) => [
        p,
        readFileSync(p, 'utf8'),
      ]),
    );
  }
  return serviceCache.get(svcDir);
}

const findings = [];
const servicesRoot = join(ROOT, 'services');
for (const svc of readdirSync(servicesRoot)) {
  const svcSrc = join(servicesRoot, svc, 'src');
  let controllers;
  try {
    controllers = walk(svcSrc, (p) => p.endsWith('.controller.ts') && !p.endsWith('.spec.ts'));
  } catch {
    continue;
  }
  for (const file of controllers) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/@(Get|Post|Patch|Put|Delete)\(\s*['"`]([^'"`]*)['"`]\s*\)/);
      if (!m) continue;
      const route = m[2];
      const params = [...route.matchAll(/:([A-Za-z0-9_]+)/g)]
        .map((x) => x[1])
        .filter((p) => p !== 'depotId' && p !== 'depotIds');
      if (!params.length) continue;

      const decorators = lines.slice(Math.max(0, i - 10), i + 5).join('\n');
      if (/@Public\(/.test(decorators) && /InternalAuthGuard/.test(decorators)) continue;
      const can = (decorators.match(/@Can\(\s*['"]([^'"]+)['"]/) || [])[1] ?? null;
      const reachable = can
        ? (CAPS[can] ?? []).some((r) => SCOPED_ROLES.includes(r))
        : !/@Public\(/.test(decorators);
      if (!reachable) continue;

      const body = handlerAt(lines, i);
      let guarded = GUARD.test(body);
      if (!guarded) {
        const calls = [...body.matchAll(/this\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\(/g)].map((c) => c[2]);
        outer: for (const method of calls) {
          for (const [, s] of servicesOf(svcSrc)) {
            if (!GUARD.test(s)) continue;
            const b = methodBody(s, method);
            if (!b) continue;
            if (GUARD.test(b)) { guarded = true; break outer; }
            for (const helper of [...b.matchAll(/this\.([A-Za-z0-9_]+)\(/g)].map((h) => h[1])) {
              const hb = methodBody(s, helper);
              if (hb && GUARD.test(hb)) { guarded = true; break outer; }
            }
          }
        }
      }
      if (!guarded) {
        findings.push(`${rel}:${i + 1} ${m[1]} ${route} @Can(${can ?? '-'})`);
      }
    }
  }
}
findings.sort();

const write = process.argv.includes('--write');
if (write) {
  writeFileSync(BASELINE, `${JSON.stringify({ count: findings.length, routes: findings }, null, 2)}\n`);
  console.log(`depot-scope: baseline written — ${findings.length} unguarded by-id routes`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`depot-scope: no baseline at ${relative(ROOT, BASELINE)}. Run with --write once.`);
  process.exit(1);
}

const known = new Set(baseline.routes);
const added = findings.filter((f) => !known.has(f));
const fixed = baseline.routes.filter((f) => !findings.includes(f));

console.log(`depot-scope: ${findings.length} unguarded by-id routes (baseline ${baseline.count})`);
if (fixed.length) {
  console.log(`  ${fixed.length} closed since the baseline:`);
  for (const f of fixed) console.log(`    - ${f}`);
}
if (added.length) {
  console.error(`  ${added.length} NEW by-id route(s) with no depot-scope check:`);
  for (const f of added) console.error(`    + ${f}`);
  console.error(
    '\nA by-id route reachable by a depot-scoped role must assert the row\'s depot —\n' +
      "`assertDepotAccess(user, row.depotId)` where the row is loaded, or name the path\n" +
      'parameter `:depotId` so DepotScopeGuard sees it. If the row is genuinely not\n' +
      'depot-owned (a customer\'s own cart, a network-wide product), run\n' +
      '`node scripts/check-depot-scope.mjs --write` and say so in the PR.',
  );
  process.exit(1);
}
if (findings.length < baseline.count) {
  console.log('  Ratchet: run `node scripts/check-depot-scope.mjs --write` to lower the baseline.');
}
process.exit(0);
