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

if (findings.length) {
  console.error(`depot-scope guard check FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('depot-scope guard check OK — every service with global auth also scopes by depot.');
