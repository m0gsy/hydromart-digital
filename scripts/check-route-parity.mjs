#!/usr/bin/env node
/**
 * PAR-20 — the direction nothing measured: SERVER → UI.
 *
 * `check-endpoint-contracts.mjs` proves every path the CLIENT builds finds a controller. It
 * sounds like it answers "is everything on the server reachable from a screen", and it
 * cannot: it only ever walks from the client. A route built, guarded, tested and reachable
 * by nobody passes it every time — which is how birthday points (FR-091), loyalty-point
 * expiry (BR-014), the refund-issue path, the reward-catalogue admin and the outbox gauge
 * all came to exist here with no way in.
 *
 * This walks the other way. Every declared route is classified:
 *
 *   internal   — /internal/, health, webhook ingest, or behind InternalAuthGuard: not for a
 *                screen, and saying so is not the same as excusing it
 *   ui         — a client path matches it (endpoints table, or a literal in a page)
 *   caller     — something else in this repo calls it: another service's HTTP adapter, a
 *                cron line, a deploy/ops script, the UAT harness
 *   orphan     — none of the above
 *
 * The orphans are recorded in `scripts/route-parity-baseline.json`. This fails when a route
 * becomes an orphan that was not one before — a new capability with no way in — and when a
 * recorded orphan stops being one without the baseline being updated, because a stale
 * baseline is how a ratchet quietly stops ratcheting.
 *
 *   node scripts/check-route-parity.mjs             # gate
 *   node scripts/check-route-parity.mjs --update    # re-record the baseline (deliberate)
 *   node scripts/check-route-parity.mjs --list      # print the orphans and stop
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const BASELINE = 'scripts/route-parity-baseline.json';
const GATEWAY_CONFIG = 'services/gateway-service/src/config/gateway-config.service.ts';
const CLIENT_DIR = 'apps/web/src/lib/endpoints';

// ---------------------------------------------------------------- shared plumbing

const splitPath = (p) =>
  p
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? ':' : s));

const matches = (route, wanted) =>
  route.length === wanted.length &&
  route.every((seg, i) => seg === ':' || wanted[i] === ':' || seg === wanted[i]);

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

/** gateway URL segment -> service directory, read from the gateway's own map. */
function segmentMap() {
  const src = readFileSync(GATEWAY_CONFIG, 'utf8');
  const block = src.slice(
    src.indexOf('const SEGMENT_ENV'),
    src.indexOf('};', src.indexOf('const SEGMENT_ENV')),
  );
  const map = {};
  for (const [, segment, env] of block.matchAll(/^\s*'?([a-zA-Z-]+)'?:\s*'([A-Z_]+)'/gm)) {
    map[segment] = `${env.replace(/_SERVICE_URL$/, '').toLowerCase()}-service`;
  }
  return map;
}

// ------------------------------------------------------------- declared routes

/** Every route a service declares, plus whether its own decorators say "internal only". */
function declaredRoutes(service) {
  const src = join('services', service, 'src');
  if (!existsSync(src)) return [];
  const routes = [];
  for (const file of walk(src, (p) => p.endsWith('.controller.ts'))) {
    const text = readFileSync(file, 'utf8');
    const controllers = [...text.matchAll(/@Controller\(([^)]*)\)/g)];
    for (let i = 0; i < controllers.length; i++) {
      const arg = controllers[i][1];
      const literal = arg.match(/path:\s*'([^']*)'/) ?? arg.match(/^\s*'([^']*)'/);
      const base = literal ? literal[1] : '';
      const from = controllers[i].index;
      const to = i + 1 < controllers.length ? controllers[i + 1].index : text.length;
      const body = text.slice(from, to);
      for (const m of body.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
        // The decorators immediately above this verb — where @UseGuards(InternalAuthGuard)
        // sits when a route is service-to-service.
        const preceding = body.slice(Math.max(0, m.index - 600), m.index);
        routes.push({
          service,
          file,
          method: m[1].toUpperCase(),
          path: splitPath(`${base}/${m[2] ?? ''}`),
          internalGuard: /InternalAuthGuard/.test(preceding),
        });
      }
    }
  }
  return routes;
}

// ------------------------------------------------------------------ who calls it

/** Every `/segment/api/v1/…` path the web client can build. */
function clientPaths() {
  const found = new Set();
  const files = [
    ...readdirSync(CLIENT_DIR)
      .filter((e) => e.endsWith('.ts'))
      .map((e) => join(CLIENT_DIR, e)),
    ...walk('apps/web/src', (p) => p.endsWith('.ts') || p.endsWith('.tsx')).filter(
      (f) => !f.includes(`endpoints${sep}`),
    ),
  ];
  for (const file of files) {
    for (const [, raw] of readFileSync(file, 'utf8').matchAll(
      /['"`](\/[a-z-]+\/api\/v1\/[^'"`\s]*)/gi,
    )) {
      found.add(normalise(raw));
    }
  }
  return [...found];
}

function normalise(raw) {
  return raw
    .replace(/\/\$\{[^${}]*\}/g, '/:')
    .replace(/\$\{[^${}]*\}/g, '')
    .split('?')[0]
    .split('$')[0]
    .replace(/\/+$/, '');
}

/**
 * Paths named anywhere OTHER than the web client: service-to-service adapters, cron lines,
 * deploy and ops scripts, the UAT harness. Proof a route has a caller even though no screen
 * reaches it — a reason, not an excuse, and the classification says which.
 */
function nonWebCallers() {
  const found = new Set();
  const roots = [
    ...readdirSync('services')
      .filter((s) => statSync(join('services', s)).isDirectory())
      .map((s) => join('services', s, 'src')),
    'scripts',
    '.uat',
  ].filter((d) => existsSync(d));

  for (const root of roots) {
    for (const file of walk(
      root,
      (p) => /\.(ts|mjs|js|sh|json)$/.test(p) && !p.includes(`${sep}node_modules${sep}`),
    )) {
      // Anywhere inside a string, not only at its start: an adapter writes
      // `${orderServiceUrl}/api/v1/orders/...`, so the character before the path is `}`.
      // Anchoring on the quote is why this counted ZERO service-to-service callers on its
      // first run — a checker that finds nothing is usually looking for the wrong shape.
      for (const [, raw] of readFileSync(file, 'utf8').matchAll(
        /(\/api\/v1\/[^'"`\s)]*)/g,
      )) {
        found.add(normalise(raw));
      }
    }
  }
  return [...found];
}

// ------------------------------------------------------------------ classify

const INTERNAL_SEGMENTS = new Set(['internal', 'health', 'healthz', 'webhook', 'webhooks']);

function classify(route, clientByService, callerPaths) {
  if (route.internalGuard) return 'internal';
  if (route.path.some((s) => INTERNAL_SEGMENTS.has(s))) return 'internal';

  const fromUi = clientByService[route.service] ?? [];
  if (fromUi.some((wanted) => matches(route.path, wanted))) return 'ui';
  if (callerPaths.some((wanted) => matches(route.path, wanted))) return 'caller';
  return 'orphan';
}

// ------------------------------------------------------------------ run

const segments = segmentMap();
const services = readdirSync('services').filter((s) => statSync(join('services', s)).isDirectory());

// Client paths, grouped by the service the gateway sends them to.
const clientByService = {};
for (const path of clientPaths()) {
  const parts = path.split('/').filter(Boolean); // segment, api, v1, ...rest
  const service = segments[parts[0]];
  if (!service) continue;
  (clientByService[service] ??= []).push(parts.slice(3));
}
const callerPaths = nonWebCallers().map((p) => splitPath(p).slice(2)); // drop api/v1

const counts = { ui: 0, internal: 0, caller: 0, orphan: 0 };
const orphans = [];
for (const service of services) {
  for (const route of declaredRoutes(service)) {
    const verdict = classify(route, clientByService, callerPaths);
    counts[verdict] += 1;
    if (verdict === 'orphan') {
      orphans.push(
        `${route.method} ${route.service.replace('-service', '')}: /${route.path.join('/')}`,
      );
    }
  }
}
orphans.sort();

const total = counts.ui + counts.internal + counts.caller + counts.orphan;
const summary =
  `${total} routes — ${counts.ui} reachable from a screen, ${counts.internal} internal, ` +
  `${counts.caller} called by something else, ${counts.orphan} orphaned`;

if (process.argv.includes('--list')) {
  console.log(summary);
  for (const o of orphans) console.log(`  ${o}`);
  process.exit(0);
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ orphans }, null, 2)}\n`);
  console.log(`recorded ${orphans.length} orphaned routes in ${BASELINE}`);
  console.log(summary);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).orphans : [];
const known = new Set(baseline);
const added = orphans.filter((o) => !known.has(o));
const gone = baseline.filter((o) => !orphans.includes(o));

console.log(summary);
if (added.length === 0 && gone.length === 0) {
  console.log('route parity OK — no new orphan, and the recorded ones are still there.');
  process.exit(0);
}
if (added.length) {
  console.error(`\n!! ${added.length} route(s) built with no way in:\n`);
  for (const a of added) console.error(`   ${a}`);
  console.error('\n   Give it a screen, or a caller — or, if it genuinely has neither yet,');
  console.error('   record that deliberately: node scripts/check-route-parity.mjs --update');
}
if (gone.length) {
  console.error(`\n!! ${gone.length} recorded orphan(s) are no longer orphaned:\n`);
  for (const g of gone) console.error(`   ${g}`);
  console.error('\n   Good news, and the baseline has to say so: --update');
}
process.exit(1);
