#!/usr/bin/env node
// H-49 — generate Prometheus's scrape targets from docker-compose.prod.yml.
//
// The target list used to be hand-maintained, and hr-service had been missing from it
// since the day it shipped (H-40): the service was running, unmonitored, and no alert
// could fire about it because Prometheus did not know it existed. A list nobody is
// forced to update stays wrong.
//
//   node scripts/gen-prometheus-targets.mjs           # write ops/prometheus-targets.json
//   node scripts/gen-prometheus-targets.mjs --check   # fail if the file is out of date (CI)
//
// The rule: a compose service is a scrape target when its environment declares its own
// listening port (`<X>_SERVICE_PORT`, or `GATEWAY_PORT` for the gateway). Every such
// service runs enableMetrics() from @hydromart/platform and serves /metrics. Infra
// exporters are NOT here — they are a separate static job in ops/prometheus.yml, because
// they are not this repo's code and do not appear in compose with a port variable.
//
// ponytail: a line scanner, not a YAML parser. The two shapes it needs (a service header
// at two-space indent, a PORT variable at six) are stable and asserted by --check on
// every CI run, so a compose reformat is caught rather than silently emptying the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(root, 'docker-compose.prod.yml');
const OUT = join(root, 'ops', 'prometheus-targets.json');

/** @returns {{targets: string[], labels: {service: string}}[]} */
export function scrapeTargets(composeText) {
  const found = [];
  let current = null;
  for (const line of composeText.split(/\r?\n/)) {
    const service = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (service) {
      current = service[1];
      continue;
    }
    if (!current) continue;
    const port = /^ {6}(?:[A-Z][A-Z0-9]*_SERVICE_PORT|GATEWAY_PORT): (\d+)\s*$/.exec(line);
    if (port) {
      found.push({
        targets: [`${current}:${port[1]}`],
        labels: { service: `${current}-service` },
      });
      current = null; // one port per service; ignore anything after it
    }
  }
  return found.sort((a, b) => a.targets[0].localeCompare(b.targets[0]));
}

const rendered = `${JSON.stringify(scrapeTargets(readFileSync(COMPOSE, 'utf8')), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let onDisk = '';
  try {
    onDisk = readFileSync(OUT, 'utf8');
  } catch {
    /* missing file reports as a mismatch below */
  }
  if (onDisk !== rendered) {
    console.error(
      'ops/prometheus-targets.json is out of date with docker-compose.prod.yml.\n' +
        'Run: node scripts/gen-prometheus-targets.mjs\n' +
        'A service missing from this file is a service no alert can ever fire about.',
    );
    process.exit(1);
  }
  console.log(`prometheus targets up to date (${scrapeTargets(readFileSync(COMPOSE, 'utf8')).length})`);
} else {
  writeFileSync(OUT, rendered);
  console.log(`wrote ${OUT} (${scrapeTargets(readFileSync(COMPOSE, 'utf8')).length} targets)`);
}
