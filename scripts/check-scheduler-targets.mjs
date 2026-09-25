#!/usr/bin/env node
/**
 * A scheduled sweep must be aimed at a service that really serves it.
 *
 *   node scripts/check-scheduler-targets.mjs
 *
 * scripts/scheduler/crontab lists every sweep as `sh /scripts/sweep.sh <path> [host:port]`. The
 * loyalty point-expiry line named `loyalty:3010`. Loyalty listens on 3009; 3010 is promo. So the
 * nightly sweep asked the WRONG SERVICE, promo answered 404, wget exited non-zero, and for eighteen
 * nights in a row the scheduler reported `FAILED` — to a Discord channel nobody had connected, and
 * to admin-service's sweep_runs (`lastOkAt: never`), where nothing read it. Points had not expired
 * once, and the switch that turns expiry on would have changed nothing.
 *
 * Nothing caught it because every check looked at ONE side: the controller test proves the route
 * exists, the crontab is prose to CI. This reads both and requires them to agree, per line:
 *   1. the host alias is a real service (`<alias>-service`);
 *   2. the port is that service's own default port (its `*_PORT` in config/env.validation.ts);
 *   3. that service declares a POST route at `/api/v1/<path>`.
 *
 * Lines without a host use sweep.sh's default, `order:3004`. Exit 0 = every sweep is aimed right.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, controllers, routePattern, serviceNames } from './lib/route-inventory.mjs';

const CRONTAB = process.env.SCHEDULER_CRONTAB ?? join(ROOT, 'scripts/scheduler/crontab');
const DEFAULT_HOST = 'order:3004'; // scripts/scheduler/sweep.sh: host="${2:-order:3004}"

/** The port a service listens on by default, or null when its config does not say. */
function defaultPort(service) {
  const file = join(ROOT, 'services', service, 'src/config/env.validation.ts');
  if (!existsSync(file)) return null;
  const m = /[A-Z_]*PORT:\s*Joi\.number\(\)\.port\(\)\.default\((\d+)\)/.exec(
    readFileSync(file, 'utf8'),
  );
  return m ? Number(m[1]) : null;
}

const known = new Set(serviceNames());
const routes = controllers();

const sweeps = readFileSync(CRONTAB, 'utf8')
  .split('\n')
  .map((line, i) => ({ line: line.trim(), n: i + 1 }))
  .filter(({ line }) => line && !line.startsWith('#'))
  .flatMap(({ line, n }) => {
    const m = /sweep\.sh\s+(\S+)(?:\s+(\S+))?/.exec(line);
    return m ? [{ n, path: m[1], host: m[2] ?? DEFAULT_HOST }] : [];
  });

const problems = [];
for (const { n, path, host } of sweeps) {
  const [alias, portText] = host.split(':');
  const service = `${alias}-service`;
  const where = `${CRONTAB}:${n}: ${path} -> ${host}`;

  if (!known.has(service)) {
    problems.push(`${where} — no service named ${service}`);
    continue;
  }
  const port = defaultPort(service);
  if (port !== null && String(port) !== portText) {
    problems.push(`${where} — ${service} listens on ${port}, not ${portText}`);
  }
  const full = `/api/v1/${path}`;
  const served = routes.some(
    (c) =>
      c.service === service &&
      c.routes.some((r) => r.method === 'POST' && routePattern(r.full).test(full)),
  );
  if (!served) {
    problems.push(`${where} — ${service} declares no POST ${full}`);
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} scheduled sweep(s) are aimed at the wrong place:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nA sweep pointed at the wrong port gets a 404 or a refusal, exits non-zero, and reads as FAILED\n' +
      'every night while the work it exists to do is never done.',
  );
  process.exit(1);
}
console.log(
  `check-scheduler-targets: all ${sweeps.length} sweeps are aimed at a service and route that exist`,
);
