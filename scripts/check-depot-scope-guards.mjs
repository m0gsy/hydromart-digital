#!/usr/bin/env node
/**
 * Every service that installs JwtAuthGuard globally must install DepotScopeGuard too.
 *
 * Three services did not — admin, product and recommendation — and the only test that
 * would have said so lived inside promo-service and named promo-service. Seventeen copies
 * of that file is not the answer; the fact is one sentence about every service at once, so
 * it is checked in one place, the same way `check-i18n.mjs` and
 * `check-endpoint-contracts.mjs` are.
 *
 * The point is not that those three leak today (they take no `depotId` parameter at all —
 * that was measured, not assumed). It is that the NEXT depot-scoped route added to them
 * would be born unguarded, silently, in a service whose sibling services all guard theirs.
 *
 *   node scripts/check-depot-scope-guards.mjs          # gate: exit 1 on any finding
 *
 * Order matters as much as presence: DepotScopeGuard reads `request.user`, which
 * JwtAuthGuard writes. Registered ahead of it, it reads an empty object and scopes nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under AGENTS.md			  role-pass-direktur-320.json
CLAUDE.md			  role-pass-direktur-360.json
Caddyfile			  role-pass-direktur-390.json
DEPLOY.md			  role-pass-direktur-412.json
README.md			  role-pass-direktur-428.json
SECURITY.md			  role-pass-direktur-geometry.json
apk-build-ops.log		  role-pass-direktur.json
apk-build.log			  role-pass-head_office-320.json
apps				  role-pass-head_office-360.json
coverage			  role-pass-head_office-390.json
dev-server.log			  role-pass-head_office-412.json
docker-compose.cache.yml	  role-pass-head_office-428.json
docker-compose.local-storage.yml  role-pass-head_office-geometry.json
docker-compose.prod.yml		  role-pass-head_office.json
docker-compose.test.yml		  role-pass-hq-320.json
docker-compose.yml		  role-pass-hq-412.json
docs				  role-pass-hq-geometry.json
export-sweep-customer.txt	  role-pass-hq.json
export-sweep-ops.txt		  role-pass-manager-320.json
fase0-cart.txt			  role-pass-manager-360.json
fase0-courier.txt		  role-pass-manager-390.json
fase0-customer.txt		  role-pass-manager-412.json
fase0-manager-dashboard.txt	  role-pass-manager-428.json
fase0-manager.txt		  role-pass-manager-dashboard.json
fase0-mgr2.txt			  role-pass-manager-geometry.json
fase0-operator.txt		  role-pass-manager.json
fase0-ops2.txt			  role-pass-operator-320.json
infra				  role-pass-operator-360.json
mobile				  role-pass-operator-390.json
next-start.log			  role-pass-operator-412.json
node_modules			  role-pass-operator-428.json
ops				  role-pass-operator-geometry.json
package-lock.json		  role-pass-operator.json
package.json			  scripts
packages			  services
release-1.1.0			  tap-courier.txt
role-pass-courier-320.json	  tap-customer.txt
role-pass-courier-360.json	  tap-hq.txt
role-pass-courier-390.json	  tap-hq2.txt
role-pass-courier-412.json	  tap-manager.txt
role-pass-courier-428.json	  tap-operator.txt
role-pass-courier-geometry.json   test
role-pass-courier.json		  tsconfig.base.json
role-pass-customer-320.json	  uat.json
role-pass-customer-360.json	  verify-courier.txt
role-pass-customer-390.json	  verify-customer.txt
role-pass-customer-412.json	  verify-manager-dashboard.txt
role-pass-customer-428.json	  verify-manager.txt
role-pass-customer-geometry.json  verify-operator.txt
role-pass-customer.json, recursively. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const SERVICES = 'services';

/** Global guards, in registration order, as they appear in a module file. */
function guardOrder(src) {
  return [...src.matchAll(/provide:\s*APP_GUARD\s*,\s*useClass:\s*(\w+)/g)].map((m) => m[1]);
}

function moduleFiles(dir) {
  const out = [];
  const modules = join(dir, 'src', 'modules');
  let entries;
  try {
    entries = readdirSync(modules);
  } catch {
    return out; // no modules/ folder — not a Nest service
  }
  for (const name of entries) {
    const p = join(modules, name);
    if (statSync(p).isFile() && name.endsWith('.module.ts')) out.push(p);
  }
  return out;
}

const findings = [];

for (const service of readdirSync(SERVICES)) {
  const dir = join(SERVICES, service);
  if (!statSync(dir).isDirectory()) continue;

  for (const file of moduleFiles(dir)) {
    const order = guardOrder(readFileSync(file, 'utf8'));
    const jwt = order.indexOf('JwtAuthGuard');
    if (jwt === -1) continue; // a module that installs no global auth is not in scope

    const scope = order.indexOf('DepotScopeGuard');
    if (scope === -1) {
      findings.push(`${file}: installs JwtAuthGuard but not DepotScopeGuard`);
      continue;
    }
    if (scope < jwt) {
      findings.push(
        `${file}: DepotScopeGuard is registered before JwtAuthGuard, so it reads an empty request.user`,
      );
    }
    const roles = order.indexOf('RolesGuard');
    if (roles !== -1 && roles < jwt) {
      findings.push(`${file}: RolesGuard is registered before JwtAuthGuard`);
    }
  }
}

/*
 * AUTHZ-A2 — the half of this check that was missing.
 *
 * Everything above asks whether the guard is INSTALLED. That question was green every day
 * while `requestedDepotId` returned the FIRST depotId it found — query, then body, then
 * params — and the handler was free to read any of the others. Any `:depotId` route could
 * therefore be waved through by pinning an own-depot `?depotId=` beside it, and five more
 * findings in the audit were symptoms of that one line.
 *
 * So the guard's own semantics are checked here too, and in the same place, because the
 * question is the same question:
 *
 *   1. it collects EVERY value, not the first (a plural collector + `.every(`);
 *   2. it reads all three sources — query, body, route params;
 *   3. it knows every KEY a handler can name a depot with. This is the general form of
 *      AUTHZ-A2: guard and handler reading different things. `depotIds` (the owner
 *      dashboard's batch parameter) was exactly this — a selector the guard had never
 *      heard of, on a route it believed it was guarding.
 */
const GUARD = 'packages/platform/src/nest/depot-scope.guard.ts';
const guardSrc = readFileSync(GUARD, 'utf8');

if (/private static requestedDepotId\s*\(/.test(guardSrc)) {
  findings.push(
    `${GUARD}: the collector is singular (requestedDepotId). It returns the FIRST depotId it ` +
      `finds, so a request naming two depots is checked against one — AUTHZ-A2.`,
  );
}
if (!/requestedDepotIds\s*\(/.test(guardSrc)) {
  findings.push(`${GUARD}: no requestedDepotIds collector — every depot value must be gathered`);
}
if (!/requested\.every\(/.test(guardSrc)) {
  findings.push(
    `${GUARD}: the check does not demand EVERY collected depot is allowed (\`requested.every(\`)`,
  );
}
for (const source of ['request.query', 'request.params']) {
  if (!guardSrc.includes(source)) {
    findings.push(`${GUARD}: never reads ${source} — a handler can, so the guard must`);
  }
}
if (!/request\.body/.test(guardSrc)) {
  findings.push(`${GUARD}: never reads request.body — a handler can, so the guard must`);
}

/** The selector keys the guard collects, read out of its own source. */
const guardedKeys = new Set(
  [...guardSrc.matchAll(/for \(const key of \[([^\]]+)\]\)/g)]
    .flatMap((m) => m[1].split(','))
    .map((k) => k.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean),
);
if (guardedKeys.size === 0) {
  findings.push(`${GUARD}: could not read the list of depot keys it collects`);
}

/*
 * Every key a CONTROLLER reads a depot from. `@Query('x')` / `@Param('x')` are the two the
 * guard can be blind to; a DTO field is covered because the guard reads the whole body.
 */
const selectorKeys = new Map(); // key -> first file that reads it
for (const service of readdirSync(SERVICES)) {
  const dir = join(SERVICES, service, 'src');
  let files;
  try {
    files = walk(dir);
  } catch {
    continue;
  }
  for (const file of files) {
    if (!file.endsWith('.controller.ts')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/@(?:Query|Param)\(\s*'([A-Za-z0-9_]*[Dd]epot[A-Za-z0-9_]*)'/g)) {
      if (!selectorKeys.has(m[1])) selectorKeys.set(m[1], file);
    }
  }
}
for (const [key, file] of selectorKeys) {
  // A key the guard does not collect is a selector it cannot see. `depotIds` was one of
  // these, on `inventory/low-stock`, for as long as that route has existed.
  if (!guardedKeys.has(key)) {
    findings.push(
      `${file}: reads a depot selector \`${key}\` that DepotScopeGuard does not collect ` +
        `(it knows: ${[...guardedKeys].join(', ')})`,
    );
  }
}

if (findings.length) {
  console.error(`depot-scope guard check FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  'depot-scope guard check OK — every service with global auth scopes by depot, the guard ' +
    'collects every depot value the request carries, and no controller reads a selector it ' +
    'cannot see.',
);
