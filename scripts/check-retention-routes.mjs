#!/usr/bin/env node
/**
 * Every retention executor must call a route that exists.
 *
 *   node scripts/check-retention-routes.mjs
 *
 * admin-service's purge engine reaches each dataset through a path written as a string in
 * services/admin-service/src/infrastructure/http/purge-executor.registry.ts. A typo, or a
 * controller route that moved, does not fail anything at build time: the sweep gets a 404,
 * records the dataset as failed, and the privacy policy goes on promising a deletion that
 * never happens. Each path is checked against the POST routes the controllers declare.
 *
 * Exit 0 = every executor path is a real POST route.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, controllers, routePattern } from './lib/route-inventory.mjs';

const REGISTRY =
  process.env.RETENTION_REGISTRY ??
  join(ROOT, 'services/admin-service/src/infrastructure/http/purge-executor.registry.ts');

const posts = controllers()
  .flatMap((c) => c.routes.map((r) => ({ ...r, service: c.service })))
  .filter((r) => r.method === 'POST')
  .map((r) => ({ ...r, re: routePattern(r.full) }));

const source = readFileSync(REGISTRY, 'utf8')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

const executors = [...source.matchAll(/dataset:\s*'([^']+)'[\s\S]*?path:\s*'([^']+)'/g)].map(
  (m) => ({ dataset: m[1], path: m[2] }),
);

if (executors.length === 0) {
  console.error('check-retention-routes: found no executors in the registry — the parser is stale');
  process.exit(1);
}

const missing = executors.filter((e) => !posts.some((p) => p.re.test(e.path)));
if (missing.length > 0) {
  console.error(
    `${missing.length} retention executor(s) call a POST route no controller declares:\n`,
  );
  for (const m of missing) console.error(`  ${m.dataset}: ${m.path}`);
  process.exit(1);
}
console.log(
  `check-retention-routes: all ${executors.length} retention executors call a real POST route`,
);
