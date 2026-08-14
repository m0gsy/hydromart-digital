#!/usr/bin/env node
/**
 * Audit F-17: the web client's endpoint table is maintained BY HAND. There is no
 * generated schema (see D-6 and scripts/check-api-responses.mjs), so nothing connected
 * `apps/web/src/lib/endpoints/*.ts` to the controllers that actually serve those paths.
 * Renaming a route in a service left the console pointing at a 404 that only showed up
 * when someone clicked the screen — typecheck, lint and every unit suite stayed green.
 *
 * This closes that gap without inventing a code generator: every path the client can
 * build is resolved through the gateway's own segment map to the owning service, and
 * matched against the routes that service declares. A path with no matching route fails
 * CI.
 *
 *   node scripts/check-endpoint-contracts.mjs            # check
 *   node scripts/check-endpoint-contracts.mjs --update   # re-record the allowlist
 *
 * The allowlist exists for paths this static reader genuinely cannot resolve (a route
 * assembled at runtime, a segment served by something other than a Nest controller). It
 * may shrink, never silently grow: --update is a deliberate, reviewable act.
 *
 * Exit 0 = every client path resolves; 1 = one does not.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWLIST = 'scripts/endpoint-contract-allowlist.json';
const GATEWAY_CONFIG = 'services/gateway-service/src/config/gateway-config.service.ts';
const CLIENT_DIR = 'apps/web/src/lib/endpoints';

// ---------------------------------------------------------------- gateway segment map

/** `{ orders: 'order-service', hr: 'hr-service', … }` straight out of SEGMENT_ENV. */
function segmentMap() {
  const src = readFileSync(GATEWAY_CONFIG, 'utf8');
  const block = src.slice(src.indexOf('const SEGMENT_ENV'), src.indexOf('};', src.indexOf('const SEGMENT_ENV')));
  const map = {};
  // Keys with a hyphen are quoted (`'hr-reports': …`); both forms are read.
  for (const [, segment, env] of block.matchAll(/^\s*'?([a-zA-Z-]+)'?:\s*'([A-Z_]+)'/gm)) {
    map[segment] = `${env.replace(/_SERVICE_URL$/, '').toLowerCase()}-service`;
  }
  return map;
}

// ------------------------------------------------------------------- declared routes

function controllerFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...controllerFiles(path));
    else if (path.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

/** Route patterns a service declares, as segment arrays with `:` marking a parameter. */
function declaredRoutes(service) {
  const src = join('services', service, 'src');
  if (!existsSync(src)) return [];
  const routes = [];
  for (const file of controllerFiles(src)) {
    const text = readFileSync(file, 'utf8');
    // Controllers appear one per file in this codebase, but a file may hold more than
    // one; each @Controller applies to the method decorators that follow it.
    const controllers = [...text.matchAll(/@Controller\(([^)]*)\)/g)];
    for (let i = 0; i < controllers.length; i++) {
      const arg = controllers[i][1];
      const literal = arg.match(/path:\s*'([^']*)'/) ?? arg.match(/^\s*'([^']*)'/);
      const base = literal ? literal[1] : '';
      const from = controllers[i].index;
      const to = i + 1 < controllers.length ? controllers[i + 1].index : text.length;
      for (const [, verb, sub] of text
        .slice(from, to)
        .matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
        routes.push({ method: verb.toUpperCase(), path: splitPath(`${base}/${sub ?? ''}`) });
      }
    }
  }
  return routes;
}

const splitPath = (p) =>
  p
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? ':' : s));

// --------------------------------------------------------------------- client paths

/**
 * Every `/segment/api/v1/…` literal the client can build. Template placeholders become
 * `:`, and a query string is dropped — the check is about the route, not its filters.
 */
function clientPaths() {
  const found = new Map(); // normalised path -> source file
  for (const entry of readdirSync(CLIENT_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    const file = join(CLIENT_DIR, entry);
    for (const [, raw] of readFileSync(file, 'utf8').matchAll(/['"`](\/[a-z-]+\/api\/v1\/[^'"`\s]*)/gi)) {
      // `/${id}` is a path parameter. A placeholder NOT preceded by a slash is a
      // suffix, not a segment — `products${productQuery(q)}` appends a query string,
      // it does not name a child route. Anything from a surviving `$` is the
      // `${qs ? `?${qs}` : ''}` tail, whose nested backticks the match above cannot
      // see past.
      const path = raw
        .replace(/\/\$\{[^${}]*\}/g, '/:')
        .replace(/\$\{[^${}]*\}/g, '')
        .split('?')[0]
        .split('$')[0]
        .replace(/\/+$/, '');
      if (!found.has(path)) found.set(path, file);
    }
  }
  return found;
}

const matches = (route, wanted) =>
  route.length === wanted.length &&
  route.every((seg, i) => seg === ':' || wanted[i] === ':' || seg === wanted[i]);

/**
 * The METHOD the client uses for each endpoint, which this check used to throw away — so
 * an `api.post` at a `@Get`-only route passed. The endpoints table holds paths; the verb
 * lives at the call site, so the two are joined here: `endpoints.<a>.<b>` in an
 * `api.<verb>(…)` call, resolved against the path that name is declared with.
 *
 * Anything not statically resolvable is COUNTED AND REPORTED rather than dropped: a check
 * that silently skips what it cannot read is how the last one ended up half blind.
 */
const RE_API =
  /api\.(get|post|put|patch|del|delete)(?:Cached)?\s*(?:<[^>]*>)?\(\s*endpoints\.([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)/g;

function clientMethods() {
  // `orders: { list: '/orders/api/v1/orders', … }` — dotted name to path template.
  const names = new Map();
  for (const entry of readdirSync(CLIENT_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    const text = readFileSync(join(CLIENT_DIR, entry), 'utf8');
    // Brace-depth walk rather than an indentation guess: these files are formatted
    // several ways, and an indent-based reader silently matched nothing at all.
    let depth = 0;
    let group = null;
    for (const line of text.split('\n')) {
      const open = line.match(/([a-zA-Z0-9_]+):\s*\{\s*$/);
      if (depth === 1 && open) group = open[1];
      const leaf = line.match(/([a-zA-Z0-9_]+):\s*(?:\([^)]*\)\s*=>\s*)?['`](\/[a-z-]+\/api\/v1\/[^'`\s]*)/i);
      if (leaf && group && depth >= 2) names.set(`${group}.${leaf[1]}`, leaf[2]);
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth <= 1) group = depth === 1 ? group : null;
    }
  }

  const calls = [];
  let unreadable = 0;
  for (const file of tsFiles('apps/web/src')) {
    const text = readFileSync(file, 'utf8');
    for (const [, verb, name] of text.matchAll(RE_API)) {
      const raw = names.get(name);
      if (!raw) {
        unreadable += 1;
        continue;
      }
      calls.push({
        method: (verb === 'del' ? 'delete' : verb).toUpperCase(),
        path: raw
          .replace(/\/\$\{[^${}]*\}/g, '/:')
          .replace(/\$\{[^${}]*\}/g, '')
          .split('?')[0]
          .split('$')[0]
          .replace(/\/+$/, ''),
        file,
        name,
      });
    }
  }
  return { calls, unreadable };
}

function tsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

// -------------------------------------------------------------------------- the check

const segments = segmentMap();
const routeCache = new Map();
const unresolved = [];

for (const [path, file] of clientPaths()) {
  const parts = path.split('/').filter(Boolean);
  const segment = parts[0];
  const service = segments[segment];
  if (!service) {
    unresolved.push({ path, file, why: `no gateway segment '${segment}'` });
    continue;
  }
  if (!routeCache.has(service)) routeCache.set(service, declaredRoutes(service));
  // `/segment/api/v1/rest…` — the service sees everything after the version.
  const wanted = parts.slice(3).map((s) => (s === ':' ? ':' : s));
  if (!routeCache.get(service).some((r) => matches(r.path, wanted))) {
    unresolved.push({ path, file, why: `${service} declares no matching route` });
  }
}

// Method mismatches: a path the client reaches with a verb the route does not declare.
const { calls, unreadable } = clientMethods();
const wrongMethod = [];
for (const call of calls) {
  const parts = call.path.split('/').filter(Boolean);
  const service = segments[parts[0]];
  if (!service) continue; // already reported as an unresolved path above
  if (!routeCache.has(service)) routeCache.set(service, declaredRoutes(service));
  const wanted = parts.slice(3);
  const declared = routeCache.get(service).filter((r) => matches(r.path, wanted));
  if (!declared.length) continue; // ditto
  if (!declared.some((r) => r.method === call.method))
    wrongMethod.push(
      `${call.method} ${call.path} — ${service} declares only ` +
        `${[...new Set(declared.map((r) => r.method))].join('/')} (${call.file}, endpoints.${call.name})`,
    );
}

if (process.argv.includes('--update')) {
  writeFileSync(ALLOWLIST, `${JSON.stringify(unresolved.map((u) => u.path).sort(), null, 2)}\n`);
  console.log(`Recorded ${unresolved.length} unresolved client path(s).`);
  process.exit(0);
}

const allowed = new Set(existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : []);
const failures = unresolved.filter((u) => !allowed.has(u.path));
const stale = [...allowed].filter((p) => !unresolved.some((u) => u.path === p));

if (wrongMethod.length > 0) {
  console.error('Client calls using a method the route does not declare:');
  for (const w of wrongMethod) console.error(`  - ${w}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error('Client endpoints that reach no declared route (audit F-17):');
  for (const f of failures) console.error(`  - ${f.path}\n      ${f.file}: ${f.why}`);
  console.error('\nEither the route moved and the client was not updated, or this path is');
  console.error('genuinely unresolvable statically — in which case run with --update and');
  console.error('say why in the PR.');
  process.exit(1);
}

console.log(
  `Endpoint contract check OK — ${clientPaths().size} client path(s), ${allowed.size} allowlisted, ` +
    `${calls.length} call site(s) method-matched` +
    (unreadable ? `, ${unreadable} call site(s) not statically resolvable` : '') +
    '.',
);
if (stale.length > 0) {
  console.log('Allowlist entries that now resolve — run with --update to drop them:');
  for (const p of stale) console.log(`  - ${p}`);
}
