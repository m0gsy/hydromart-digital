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
