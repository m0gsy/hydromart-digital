#!/usr/bin/env node
/*
 * Every production container must carry the log cap in its OWN definition.
 *
 * `ops/docker-daemon.json` caps json-file logs at 50m x 3, but the daemon reads that once, when
 * a container is created. Measured 2026-09-28: the file on the box was identical to the repo's,
 * live-restore was on, and the running gateway still reported `{}` — so the Discord alert
 * "running containers do not carry max-size=50m" fired for a host that was configured
 * correctly, and no amount of restarting Docker could clear it.
 *
 * The cap therefore lives in docker-compose.prod.yml too (`x-logging`). This fails when a
 * service is added without it, or when the two copies of the number drift apart.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const problems = [];
const daemon = JSON.parse(readFileSync('ops/docker-daemon.json', 'utf8'));
const want = daemon['log-opts'];
const compose = yaml.load(readFileSync('docker-compose.prod.yml', 'utf8'));

// js-yaml 5 leaves `<<` as a literal key; Compose resolves it, so resolve it the same way
// (one level: the service's own keys win over the anchor's).
const resolved = (service) => ({ ...(service['<<'] ?? {}), ...service });

for (const [name, raw] of Object.entries(compose.services ?? {})) {
  const service = resolved(raw);
  const log = service.logging;
  if (!log) {
    problems.push(`${name}: no \`logging:\` — it would be created with whatever the daemon holds, i.e. uncapped on a host that never restarted Docker.`);
    continue;
  }
  if (log.driver !== daemon['log-driver']) {
    problems.push(`${name}: logging.driver is '${log.driver}', daemon.json says '${daemon['log-driver']}'.`);
  }
  for (const key of Object.keys(want)) {
    if (String(log.options?.[key]) !== String(want[key])) {
      problems.push(`${name}: logging.options.${key} is '${log.options?.[key]}', daemon.json says '${want[key]}'.`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `!! ${p}`).join('\n'));
  process.exit(1);
}
console.log(`ok — ${Object.keys(compose.services).length} services carry ${want['max-size']} x ${want['max-file']}`);
