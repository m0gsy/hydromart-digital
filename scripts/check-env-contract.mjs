#!/usr/bin/env node
// Q-6: every environment variable a service READS must be a key its Joi schema
// VALIDATES at boot.
//
// Nest's ConfigModule validates the schema and then hands back everything else
// untouched, so `config.get('SOME_KEY')` for a key the schema never mentions is
// not a boot error — it is `undefined` at 3am, usually inside a `??` that turns a
// missing production value into a plausible-looking default. The schema is the
// contract; this check is what makes it one.
//
// Run: node scripts/check-env-contract.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Set by the runtime or the platform itself, never by our compose files.
const AMBIENT = new Set(['NODE_ENV', 'TZ', 'PORT', 'HOSTNAME', 'npm_package_version']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Top-level keys of the `Joi.object({ ... })` in a service's env.validation.ts. */
function schemaKeys(source) {
  const keys = new Set();
  for (const m of source.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)) keys.add(m[1]);
  return keys;
}

/** Every env key the service reads, however it reads it. */
function readKeys(source) {
  const keys = new Map(); // key -> first matching snippet
  const patterns = [
    /\.(?:get|getOrThrow)(?:<[^>]*>)?\(\s*'([A-Z][A-Z0-9_]*)'/g,
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[\s*'([A-Z][A-Z0-9_]*)'/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) if (!keys.has(m[1])) keys.set(m[1], m[0]);
  }
  return keys;
}

const services = readdirSync('services').filter((s) => {
  try {
    return statSync(join('services', s, 'src', 'config', 'env.validation.ts')).isFile();
  } catch {
    return false;
  }
});

let failed = 0;
for (const svc of services) {
  const root = join('services', svc, 'src');
  const schema = schemaKeys(readFileSync(join(root, 'config', 'env.validation.ts'), 'utf8'));
  const unvalidated = new Map();

  for (const file of walk(root)) {
    if (file.endsWith(join('config', 'env.validation.ts'))) continue;
    for (const [key, snippet] of readKeys(readFileSync(file, 'utf8'))) {
      if (schema.has(key) || AMBIENT.has(key)) continue;
      if (!unvalidated.has(key)) unvalidated.set(key, `${file} — ${snippet}`);
    }
  }

  if (unvalidated.size) {
    failed += unvalidated.size;
    console.error(`\n✗ ${svc}: ${unvalidated.size} env var(s) read but not in the Joi schema`);
    for (const [key, where] of unvalidated) console.error(`    ${key}\n      ${where}`);
  }
}

console.log(
  `\nenv contract: ${services.length} services checked, ${failed} unvalidated read${failed === 1 ? '' : 's'}`,
);

if (failed) {
  console.error(
    '\nAdd the key to that service\'s src/config/env.validation.ts (with a default,\n' +
      'or `.required()` when there is no safe default). If it is genuinely ambient,\n' +
      'add it to AMBIENT in this script — with a reason.\n',
  );
  process.exit(1);
}

/*
 * The inverse (§K). The check above catches a key that is READ but never declared. It
 * cannot catch one that is DECLARED but never supplied — and that is the hole J-1 fell
 * through: `ORDER_SERVICE_URL` was missing from customer-service in both compose files
 * while seven other services had it, the adapter failed soft on the empty string, and
 * three screens showed zeros for weeks with nothing in any log.
 *
 * Rule: a schema key that is neither `.default(...)` nor `.optional()` has no safe unset
 * value, so production must supply it. The other two say in the schema itself that being
 * unset is fine, and this check takes them at their word. Everything already missing today
 * is listed in `MISSING_BASELINE` and this fails only on a NEW one, exactly like the
 * api-response ratchet: the point is to stop the hole growing, not to hold this branch
 * responsible for the whole backlog.
 */

/** Keys known-missing today, per compose service. Shrink this; never grow it. */
const MISSING_BASELINE = {};

/** `KEY:` lines under a `x-*` anchor or a service's `environment:` block. */
function composeEnv(text) {
  const lines = text.split(/\r?\n/);
  const anchors = new Map(); // anchor name -> Set(keys)
  const services = new Map(); // service name -> { keys:Set, uses:string[] }

  let mode = null; // {kind:'anchor'|'service', name, indent}
  let inEnvironment = false;
  let service = null;

  for (const line of lines) {
    if (/^x-[a-z-]+:\s*&([a-z-]+)/.test(line)) {
      const name = line.match(/&([a-z-]+)/)[1];
      anchors.set(name, new Set());
      mode = { kind: 'anchor', name };
      continue;
    }
    if (/^services:\s*$/.test(line)) {
      mode = { kind: 'services' };
      continue;
    }
    if (mode?.kind === 'anchor') {
      const key = line.match(/^ {2}([A-Z][A-Z0-9_]*):/);
      if (key) anchors.get(mode.name).add(key[1]);
      else if (/^\S/.test(line) && line.trim()) mode = null;
      continue;
    }
    if (mode?.kind !== 'services') continue;

    const svcName = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (svcName) {
      service = svcName[1];
      services.set(service, { keys: new Set(), uses: [] });
      inEnvironment = false;
      continue;
    }
    if (!service) continue;
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) inEnvironment = false;
    if (!inEnvironment) continue;

    const use = line.match(/^ {6}<<:\s*\*([a-z-]+)/);
    if (use) services.get(service).uses.push(use[1]);
    const key = line.match(/^ {6}([A-Z][A-Z0-9_]*):/);
    if (key) services.get(service).keys.add(key[1]);
  }

  for (const entry of services.values()) {
    for (const anchor of entry.uses) for (const k of anchors.get(anchor) ?? []) entry.keys.add(k);
  }
  return services;
}

/** Schema keys the service cannot boot correctly without: no `.default(...)`, no `.optional()`. */
function keysThatMustBeSupplied(source) {
  const out = new Set();
  // One declaration may wrap over several lines: read from the key to the next key.
  const body = source.split(/\r?\n/);
  let current = null;
  let buffer = '';
  const flush = () => {
    if (current && !/\.default\s*\(|\.optional\s*\(/.test(buffer)) out.add(current);
  };
  for (const line of body) {
    const key = line.match(/^ {2}([A-Z][A-Z0-9_]*):/);
    if (key) {
      flush();
      current = key[1];
      buffer = line;
    } else if (current) {
      buffer += `\n${line}`;
    }
  }
  flush();
  return out;
}

const PROD_COMPOSE = 'docker-compose.prod.yml';
const composeServices = composeEnv(readFileSync(PROD_COMPOSE, 'utf8'));
const newlyMissing = [];

for (const svc of services) {
  // `auth-service` is the `auth` block; a service with no block is not deployed here.
  const compose = composeServices.get(svc.replace(/-service$/, ''));
  if (!compose) continue;
  const declared = keysThatMustBeSupplied(
    readFileSync(join('services', svc, 'src', 'config', 'env.validation.ts'), 'utf8'),
  );
  const allowed = new Set(MISSING_BASELINE[svc] ?? []);
  for (const key of declared) {
    if (compose.keys.has(key) || AMBIENT.has(key) || allowed.has(key)) continue;
    newlyMissing.push(`${svc}: ${key} is required by the schema and never supplied`);
  }
}

if (newlyMissing.length) {
  console.error(`\n✗ ${newlyMissing.length} declared-but-never-supplied env key(s):`);
  for (const line of newlyMissing) console.error(`    ${line}`);
  console.error(
    `\nAdd it to the service's block in ${PROD_COMPOSE} (and .env.example), give it a\n` +
      'safe `.default(...)` or an honest `.optional()` in the Joi schema, or — if it is\n' +
      'supplied some other way — record it in MISSING_BASELINE in this script with a reason.\n',
  );
  process.exit(1);
}

console.log(`env supply: ${composeServices.size} compose service(s) checked, none newly missing`);
