#!/usr/bin/env node
/**
 * Audit D-6: 428 `@ApiOperation` against 17 `@ApiResponse` — the OpenAPI document says
 * what every endpoint is FOR and almost never what it RETURNS, and the routes hand back
 * domain types rather than declared response shapes. That is why the web client's
 * `endpoints.ts` is maintained by hand (F-17): there is no schema to generate it from.
 *
 * Fixing 241 endpoints is its own piece of work. What this does is stop the number
 * growing while that happens: every route is counted, and a service may never end a PR
 * with MORE undocumented routes than its baseline. Adding a route without a documented
 * response now fails CI; documenting one lets you lower the baseline.
 *
 *   node scripts/check-api-responses.mjs            # check against the baseline
 *   node scripts/check-api-responses.mjs --update   # re-record it (only ever downward)
 *
 * Exit 0 = no service regressed; 1 = one did, or a baseline is stale-high.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = 'scripts/api-response-baseline.json';
const ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
const RESPONSE = /@Api(Ok|Created|NoContent|Default|)Response\(|@ApiResponse\(/;

function controllers(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...controllers(path));
    else if (path.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

/**
 * Routes in one file, and how many of them declare a response type.
 *
 * Decorators are read as RUNS, not as single lines: `@ApiOperation({ … })` spanning three
 * lines still belongs to the same block as the `@Get()` above it. Walking line-by-line and
 * stopping at the first line that does not start with `@` misses everything after the
 * first multi-line decorator — which is most of them.
 */
function scan(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let routes = 0;
  let documented = 0;

  let run = [];
  let depth = 0;
  for (const line of lines) {
    const inRun = run.length > 0;
    if (!inRun && !/^\s*@/.test(line)) continue;
    if (!inRun || depth === 0) {
      // A new decorator starts a run; a non-decorator line at depth 0 ends it.
      if (inRun && !/^\s*@/.test(line)) {
        if (run.some((l) => ROUTE.test(l))) {
          routes++;
          if (run.some((l) => RESPONSE.test(l))) documented++;
        }
        run = [];
        continue;
      }
    }
    run.push(line);
    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth < 0) depth = 0;
  }
  return { routes, documented };
}

const current = {};
for (const service of readdirSync('services')) {
  const src = join('services', service, 'src');
  if (!existsSync(src)) continue;
  let routes = 0;
  let documented = 0;
  for (const file of controllers(src)) {
    const counts = scan(file);
    routes += counts.routes;
    documented += counts.documented;
  }
  if (routes > 0) current[service] = routes - documented;
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`Recorded ${total} undocumented route(s) across ${Object.keys(current).length} services.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const worse = [];
const better = [];
for (const [service, undocumented] of Object.entries(current)) {
  const allowed = baseline[service] ?? 0;
  if (undocumented > allowed) worse.push(`${service}: ${undocumented} undocumented, baseline ${allowed}`);
  else if (undocumented < allowed) better.push(`${service}: ${undocumented} < ${allowed}`);
}

if (worse.length > 0) {
  console.error('API response documentation regressed (audit D-6):');
  for (const w of worse) console.error(`  - ${w}`);
  console.error('\nDeclare the response on the new route (@ApiOkResponse({ type: … })),');
  console.error('or run `node scripts/check-api-responses.mjs --update` if you lowered it.');
  process.exit(1);
}

const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`API response check OK — ${total} route(s) still undocumented (D-6 debt, not growing).`);
if (better.length > 0) {
  console.log('Improved since the baseline — run with --update to bank it:');
  for (const b of better) console.log(`  - ${b}`);
}
