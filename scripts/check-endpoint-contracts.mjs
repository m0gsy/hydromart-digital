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
import { join, sep } from 'node:path';

const ALLOWLIST = 'scripts/endpoint-contract-allowlist.json';
const SERVICE_ALLOWLIST = 'scripts/service-call-allowlist.json';
const GATEWAY_CONFIG = 'services/gateway-service/src/config/gateway-config.service.ts';
const CLIENT_DIR = 'apps/web/src/lib/endpoints';

// ---------------------------------------------------------------- gateway segment map

/** `{ orders: 'order-service', hr: 'hr-service', … }` straight out of SEGMENT_ENV. */
function segmentMap() {
  const src = readFileSync(GATEWAY_CONFIG, 'utf8');
  const block = src.slice(
    src.indexOf('const SEGMENT_ENV'),
    src.indexOf('};', src.indexOf('const SEGMENT_ENV')),
  );
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
 * `:`, and a query string is dropped HERE — a filter is not a route segment. The filters
 * are checked separately, by name, in `queryParamFindings` below.
 */
function clientPaths() {
  const found = new Map(); // normalised path -> source file
  // The endpoints table AND everywhere else. A URL built by hand in a page bypasses the
  // table entirely, so scanning only the table measured the paths that were already the
  // most disciplined ones. `lib/endpoints/*.ts` still comes first so its file is the one
  // reported when the same path appears twice.
  const files = [
    ...readdirSync(CLIENT_DIR)
      .filter((e) => e.endsWith('.ts'))
      .map((e) => join(CLIENT_DIR, e)),
    ...tsFiles('apps/web/src').filter((f) => !f.includes(`endpoints${sep}`)),
  ];
  for (const file of files) {
    for (const [, raw] of readFileSync(file, 'utf8').matchAll(
      /['"`](\/[a-z-]+\/api\/v1\/[^'"`\s]*)/gi,
    )) {
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
 *
 * Reported, though, is not the same as checked — and for a long time the number was printed
 * on the SUCCESS line and nowhere else. 305 of 668 call sites, 46%, were unverified every
 * day while the gate said OK. So the count is a RATCHET now
 * (`scripts/endpoint-contract-baseline.json`): it may fall, and a change that raises it
 * fails the build. That does not make the 305 checked; it makes the 306th impossible to add
 * without saying so.
 */
const RE_API =
  /api\.(get|post|put|patch|del|delete)(?:Cached)?\s*(?:<[^(]*>)?\(\s*endpoints\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){1,2})/g;

function clientMethods() {
  // `orders: { list: '/orders/api/v1/orders', … }` — dotted name to path template.
  const names = new Map();
  for (const entry of readdirSync(CLIENT_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    const text = readFileSync(join(CLIENT_DIR, entry), 'utf8');
    // Brace-depth walk rather than an indentation guess: these files are formatted
    // several ways, and an indent-based reader silently matched nothing at all.
    /*
     * A STACK of names, not one `group`.
     *
     * The endpoints table nests three deep in several places — `admin.tickets.get`,
     * `procurement.suppliers.detail`, `deliveries.settlement.get` — and this only ever
     * recorded `<group>.<leaf>`. A call written `api.get(endpoints.admin.tickets.get(id))`
     * therefore matched nothing, and every one of those call sites was counted as a verb
     * nobody checks. The ratchet caught four of them arriving at once, which is what
     * pointed at this rather than at the calls.
     *
     * Every suffix of the path is registered, so a two-part reference to a three-deep entry
     * still resolves and nothing that used to resolve stops.
     */
    let depth = 0;
    const stack = [];
    for (const line of text.split('\n')) {
      const open = line.match(/([a-zA-Z0-9_]+):\s*\{\s*$/);
      const leaf = line.match(
        /([a-zA-Z0-9_]+):\s*(?:\([^)]*\)\s*=>\s*)?['`](\/[a-z-]+\/api\/v1\/[^'`\s]*)/i,
      );
      if (leaf && stack.length > 0) {
        const path = [...stack, leaf[1]];
        // Longest first, then every shorter suffix: `admin.tickets.get`, `tickets.get`.
        for (let i = 0; i < path.length - 1; i += 1) {
          const key = path.slice(i).join('.');
          if (!names.has(key)) names.set(key, leaf[2]);
        }
      }
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      if (open && opens === 1 && closes === 0) stack.push(open[1]);
      else if (opens > closes) stack.push(null);
      depth += opens - closes;
      for (let i = 0; i < closes - opens; i += 1) stack.pop();
      if (depth <= 0) stack.length = 0;
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

/**
 * Query parameters the client sends by NAME, checked against the controller that serves
 * the route. The path check deliberately drops the query — a filter is not a route — but a
 * param the server never reads is a filter that silently does nothing: the screen shows
 * "depot: Dago" and the list is every depot.
 *
 * Only literal `name=` pairs are read; `?${p.toString()}` is built at runtime and is
 * counted as unreadable rather than guessed at. A name the controller mentions ANYWHERE in
 * its file counts as declared — DTO classes live beside their controllers, and demanding a
 * precise `@Query('name')` would fail every route that takes a DTO object.
 */
function queryParamFindings(segments, routeCache) {
  const findings = [];
  let unreadable = 0;
  for (const entry of readdirSync(CLIENT_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    const text = readFileSync(join(CLIENT_DIR, entry), 'utf8');
    for (const [, raw] of text.matchAll(/['"`](\/[a-z-]+\/api\/v1\/[^'"`\s]*\?[^'"`\s]*)/gi)) {
      const [pathPart, queryPart] = raw.split('?');
      const names = [...queryPart.matchAll(/(?:^|&)([a-zA-Z][a-zA-Z0-9_]*)=/g)].map((m) => m[1]);
      if (names.length === 0) {
        unreadable += 1;
        continue;
      }
      const parts = pathPart
        .replace(/\/\$\{[^${}]*\}/g, '/:')
        .replace(/\$\{[^${}]*\}/g, '')
        .split('/')
        .filter(Boolean);
      const service = segments[parts[0]];
      if (!service) continue;
      if (!routeCache.has(service)) routeCache.set(service, declaredRoutes(service));
      const src = serviceText(service);
      for (const name of names) {
        if (!new RegExp(`\\b${name}\\b`).test(src)) {
          findings.push(`${raw.split('?')[0]}?${name}= — ${service} never mentions "${name}"`);
        }
      }
    }
  }
  return { findings, unreadable };
}

/**
 * Every `.ts` under a service's `src`, as one string. Cached, because this is asked once per
 * query parameter. The whole tree rather than just the controllers: a param name reaches the
 * server through a DTO class, a Zod schema or a service method signature, and any of those
 * counts as "the server knows this name".
 */
const serviceTextCache = new Map();
function serviceText(service) {
  if (!serviceTextCache.has(service)) {
    let text = '';
    try {
      for (const f of tsFiles(join('services', service, 'src'))) text += readFileSync(f, 'utf8');
    } catch {
      text = '';
    }
    serviceTextCache.set(service, text);
  }
  return serviceTextCache.get(service);
}

// ------------------------------------------------------ service -> service call contracts

/**
 * The browser is not the only client. Seventeen services call each other over HTTP through
 * hand-written adapters, and those URLs were checked by nothing at all: the console at least
 * had a typed endpoints table, while `${this.config.orderServiceUrl}/api/v1/orders/${id}/status`
 * is a string nobody validates until a courier's assign returns 422 in production.
 *
 * Same questions as the frontend half, against the same `declaredRoutes()`: does the path
 * exist on the service that owns it, and is the method one that route declares.
 *
 * The three facts live in three places, which is the whole difficulty: the TARGET is in the
 * template's leading `${…}`, the VERB is on whichever method calls `fetch`, and for a helper
 * the PATH is at the CALL SITE. A first draft that read only the template reported eleven
 * POSTs as GETs and pinned four of hr-service's calls on the wrong service.
 */

const serviceOf = (env) =>
  `${env.slice(0, -'_SERVICE_URL'.length).toLowerCase().replace(/_/g, '-')}-service`;

/**
 * How one service's config names other services' base URLs, in the two shapes it uses:
 *   `byProp`   direct — `get orderServiceUrl() { … 'ORDER_SERVICE_URL' }`, and keys inside a
 *              returned object (`hrUrl: … 'HR_SERVICE_URL'`).
 *   `byGetter` the getter that RETURNS such an object — hr-service has three getters whose
 *              key is called `url`, so the key alone resolves to whichever was written last.
 *              Colliding keys are dropped rather than guessed at.
 */
function urlProps(service) {
  const dir = join('services', service, 'src', 'config');
  const byProp = {};
  const byGetter = {};
  const collided = new Set();
  if (!existsSync(dir)) return { byProp, byGetter };
  for (const file of tsFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const [, prop, env] of text.matchAll(
      /(?:get\s+)?([a-zA-Z0-9_]+)\s*(?:\(\)[^{;]*\{\s*return\s+|:\s*)this\.config\.(?:get|getOrThrow)(?:<[^(]*>)?\(\s*'([A-Z0-9_]+)'/g,
    )) {
      if (!env.endsWith('_SERVICE_URL')) continue;
      if (prop in byProp && byProp[prop] !== serviceOf(env)) collided.add(prop);
      byProp[prop] = serviceOf(env);
    }
    for (const getter of text.matchAll(/get\s+([a-zA-Z0-9_]+)\s*\([^)]*\)[^{]*\{/g)) {
      const body = text.slice(getter.index, text.indexOf('\n  }', getter.index));
      const envs = [...new Set([...body.matchAll(/'([A-Z0-9_]+_SERVICE_URL)'/g)].map((m) => m[1]))];
      if (envs.length === 1) byGetter[getter[1]] = serviceOf(envs[0]);
    }
  }
  for (const prop of collided) delete byProp[prop];
  return { byProp, byGetter };
}

/**
 * A path template as a comparable route: `${…}` becomes `:`, the query string goes. A
 * template holding a NESTED template (`…/sla${q ? `?${q}` : ''}`) is cut short by the outer
 * backtick match, leaving a dangling `${` — everything from there is the query tail, and is
 * dropped rather than guessed at.
 */
const normalisePath = (p) => {
  // A placeholder PRECEDED BY A SLASH is a path parameter; one that is not is a suffix on
  // the segment before it — `loyalty/me${scope}` appends `?depotId=…`, it does not name a
  // child route called `:`. Same rule the client half already applies.
  let s = p
    .replace(/\/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '/:')
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const dangling = s.indexOf('${');
  if (dangling >= 0) s = s.slice(0, dangling);
  return s
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+|\/+$/g, '');
};

const stripVersion = (p) => p.replace(/^\/?api\/v1\/?/, '');

/** Class methods as `{ name, params, body }`, in source order. */
const NOT_A_METHOD = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'else',
  'do',
  'constructor',
]);
function methodBodies(text) {
  const decls = [
    ...text.matchAll(
      /^\s{2}(?:(?:private|public|protected|static|readonly)\s+)*(?:async\s+)?([a-zA-Z0-9_]+)\s*(?:<[^(]*>)?\(([^)]*)\)/gm,
    ),
  ].filter((d) => !NOT_A_METHOD.has(d[1]));
  return decls.map((d, i) => ({
    name: d[1],
    params: d[2].match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*[:,)])/g) ?? [],
    body: text.slice(d.index, i + 1 < decls.length ? decls[i + 1].index : text.length),
  }));
}

/**
 * The verb of the first `fetch` in `body`. No `method:` is not a guess — fetch defaults to
 * GET. A `method:` that is not a literal (`method: init.method`) returns DYNAMIC: the verb
 * is chosen by the caller, so it has to be read there, at the call site.
 */
const DYNAMIC = 'DYNAMIC';
function fetchVerb(body) {
  const call = body.indexOf('fetch(');
  if (call < 0) return null;
  // Stop at the next URL so a GET without `method:` cannot borrow the next call's verb.
  const next = body.indexOf('/api/v1/', body.indexOf('/api/v1/', call) + 1);
  const window = body.slice(call, next > call ? next : call + 400);
  const named = window.match(/method:\s*([^,\n]+)/);
  // `{ method, headers }` — the shorthand is the caller's verb too, and reads as no method
  // at all if you only look for a colon.
  if (!named) return /\{[^}]*\bmethod\b\s*[,}]/.test(window) ? DYNAMIC : 'GET';
  const literal = named[1].match(/^['"]([A-Za-z]+)['"]/);
  return literal ? literal[1].toUpperCase() : DYNAMIC;
}

/** The argument list of the call starting at `at`, to its matching close paren. */
function argsAt(text, at) {
  const open = text.indexOf('(', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1, open + 400);
}

/**
 * The verb an argument list names, for a helper whose own `method:` is the caller's. Read
 * from the ARGUMENT LIST only: a fixed 400-character window walked straight into the
 * helper's own signature and took the verb out of `method: 'GET' | 'POST'`.
 */
function verbAtCallSite(text, at) {
  const args = argsAt(text, at);
  const named = args.match(/method:\s*['"]([A-Za-z]+)['"]/);
  if (named) return named[1].toUpperCase();
  const positional = args.match(/,\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i);
  return positional ? positional[1].toUpperCase() : null;
}

/**
 * `${url.replace(/\/$/, '')}` — which service is that? Whichever identifier in the expression
 * either names a base-URL config property directly, or was destructured out of a config
 * getter that returns one (`const { url, internalKey } = this.config.identityService`).
 */
function resolveTarget(expr, props, aliases) {
  const ids = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return ids.map((id) => aliases.get(id) ?? props.byProp[id] ?? props.byGetter[id]).find(Boolean);
}

/** Locals bound to a config getter in `body`, both `const { url } = …` and `const u = …`. */
function configAliases(body, props) {
  const aliases = new Map();
  for (const [, names, getter] of body.matchAll(
    /\{([^}]*)\}\s*=\s*this\.config\.([a-zA-Z0-9_]+)/g,
  )) {
    const target = props.byGetter[getter];
    if (!target) continue;
    for (const name of names.split(',')) {
      const id = name.trim().split(':').pop().trim();
      if (id) aliases.set(id, target);
    }
  }
  for (const [, id, getter] of body.matchAll(
    /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*this\.config\.([a-zA-Z0-9_]+)/g,
  )) {
    const target = props.byGetter[getter] ?? props.byProp[getter];
    if (target) aliases.set(id, target);
  }
  return aliases;
}

/**
 * Every template literal in `body` whose leading `${…}` names another service's base URL,
 * as `{ target, rest }`. That leading placeholder is the whole test for "is this an outbound
 * URL" — `/api/v1/` is not, because one adapter builds `${orderServiceUrl}${path}` and keeps
 * the version prefix at the call site.
 */
function outboundTemplates(body, props, aliases) {
  const out = [];
  for (const [, raw] of body.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const head = raw.match(/^\$\{((?:[^{}]|\{[^{}]*\})*)\}/);
    if (!head) continue;
    const target = resolveTarget(head[1], props, aliases);
    if (target) out.push({ target, rest: raw.slice(head[0].length), at: body.indexOf(raw) });
  }
  return out;
}

/** One adapter file, in three passes — one per fact. */
function fileCalls(text, props) {
  const calls = [];
  const unreadable = [];
  const methods = methodBodies(text);
  const fileAliases = configAliases(text, props);
  const aliasesIn = (body) => new Map([...fileAliases, ...configAliases(body, props)]);

  // ---- pass 1: who issues the request, and with which verb. `sales()` hands its URL to
  // `getInternal(url)`, which hands it to `fetchJson(url)`, which fetches — two hops, so
  // this is a fixed point rather than a single lookup.
  const verbs = new Map();
  for (const m of methods) {
    const verb = fetchVerb(m.body);
    if (verb !== null) verbs.set(m.name, verb);
  }
  for (let hop = 0; hop < methods.length; hop++) {
    let grew = false;
    for (const m of methods) {
      if (verbs.has(m.name)) continue;
      for (const [name, verb] of [...verbs]) {
        // A BARE IDENTIFIER argument means this method passes a URL down. A template
        // argument means it names a path of its own, and belongs in pass 2 instead.
        if (
          new RegExp(`this\\.${name}\\b(?:<[^(]*>)?\\(\\s*[A-Za-z_][A-Za-z0-9_]*\\s*[,)]`).test(
            m.body,
          )
        ) {
          verbs.set(m.name, verb);
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }

  // ---- pass 2: each outbound template is either a call (the path is in it) or a helper
  // (the path is one of the method's parameters).
  const helpers = [];
  for (const m of methods) {
    for (const tpl of outboundTemplates(m.body, props, aliasesIn(m.body))) {
      const param = m.params.find((p) => tpl.rest.includes(`\${${p}}`));
      if (param) {
        helpers.push({
          name: m.name,
          target: tpl.target,
          rest: tpl.rest,
          param,
          verb: verbs.get(m.name) ?? null,
        });
        continue;
      }
      // `sales()` issues nothing itself: it builds the URL and hands it to `getInternal`.
      // The verb of the call it is an argument to is this call's verb.
      const wrapping = m.body
        .slice(Math.max(0, tpl.at - 80), tpl.at)
        .replace(/`\s*$/, '') // `at` is the template CONTENT - its opening backtick sits here
        .match(/this\.([A-Za-z0-9_]+)[^.]*\(\s*$/);
      const verb = verbs.get(m.name) ?? (wrapping ? verbs.get(wrapping[1]) : undefined);
      const path = stripVersion(normalisePath(tpl.rest));
      if (!verb || verb === DYNAMIC) {
        unreadable.push(`${m.name}() builds ${path} but nothing here issues it`);
        continue;
      }
      calls.push({ target: tpl.target, method: verb, path });
    }
  }

  // ---- pass 3: expand each helper through its literal call sites.
  for (const helper of helpers) {
    // The path literal is not always the FIRST argument — one adapter names its subject
    // first — so the whole argument list is read and its first literal taken.
    const sites = [];
    for (const call of text.matchAll(new RegExp(`this\\.${helper.name}\\b(?:<[^(]*>)?\\(`, 'g'))) {
      const literal = argsAt(text, call.index).match(/['`]([^'`]+)['`]/);
      if (literal) sites.push({ 1: literal[1], index: call.index });
    }
    if (sites.length === 0) {
      // No literal ever passed: the parameter is a path PARAMETER, not a path. That is
      // `orders/${orderId}/status`, not a helper — so it is one call, with `:` in its place.
      if (helper.verb && helper.verb !== DYNAMIC) {
        calls.push({
          target: helper.target,
          method: helper.verb,
          path: stripVersion(normalisePath(helper.rest)),
        });
      } else {
        unreadable.push(`no literal call site for this.${helper.name}()`);
      }
      continue;
    }
    for (const site of sites) {
      // A helper that fetches nothing itself (`url()` returns a string someone else
      // fetches) takes the verb of the method its result is handed to, at the call site.
      const wrapping = text
        .slice(Math.max(0, site.index - 60), site.index)
        .match(/this\.([A-Za-z0-9_]+)\b(?:<[^(]*>)?\(\s*$/);
      // A helper whose own `method:` is the caller's (`{ method: init.method }`, or the
      // shorthand `method,`) gets its verb from THIS argument list, not from the fetch.
      const own = helper.verb === DYNAMIC ? verbAtCallSite(text, site.index) : helper.verb;
      const verb = own ?? (wrapping ? verbs.get(wrapping[1]) : null);
      if (!verb || verb === DYNAMIC) {
        unreadable.push(`this.${helper.name}('${site[1]}') — no verb reachable from the call site`);
        continue;
      }
      calls.push({
        target: helper.target,
        method: verb,
        path: stripVersion(normalisePath(helper.rest.replace(`\${${helper.param}}`, site[1]))),
      });
    }
  }
  return { calls, unreadable };
}

function serviceCalls() {
  const calls = [];
  const unresolvable = [];
  for (const service of readdirSync('services')) {
    const src = join('services', service, 'src');
    if (!existsSync(src)) continue;
    const props = urlProps(service);
    for (const file of tsFiles(src)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('fetch(')) continue; // an inbound route literal is not a call
      const found = fileCalls(text, props);
      for (const call of found.calls) calls.push({ service, file, ...call });
      for (const why of found.unreadable) unresolvable.push({ file, why });
    }
  }
  return { calls, unresolvable };
}

const { calls: outbound, unresolvable: outboundUnreadable } = serviceCalls();
const serviceFindings = [];
for (const call of outbound) {
  if (!routeCache.has(call.target)) routeCache.set(call.target, declaredRoutes(call.target));
  const declared = routeCache
    .get(call.target)
    .filter((r) => matches(r.path, call.path.split('/').filter(Boolean)));
  const id = `${call.method} ${call.target}/${call.path}`;
  if (declared.length === 0) {
    serviceFindings.push({ id, detail: `${call.file}: ${call.target} declares no matching route` });
  } else if (!declared.some((r) => r.method === call.method)) {
    serviceFindings.push({
      id,
      detail: `${call.file}: ${call.target} declares only ${[...new Set(declared.map((r) => r.method))].join('/')}`,
    });
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

const query = queryParamFindings(segments, routeCache);

const UNREADABLE_BASELINE = 'scripts/endpoint-contract-baseline.json';

if (process.argv.includes('--update')) {
  writeFileSync(ALLOWLIST, `${JSON.stringify(unresolved.map((u) => u.path).sort(), null, 2)}\n`);
  console.log(`Recorded ${unresolved.length} unresolved client path(s).`);
  // Both baselines, one flag. This block exits, so a ceiling recorded further down would
  // never be reached — which is how the first version of the ratchet wrote nothing at all.
  writeFileSync(
    UNREADABLE_BASELINE,
    `${JSON.stringify({ unresolvedCallSites: unreadable }, null, 2)}\n`,
  );
  console.log(`Recorded ${unreadable} unresolvable call site(s) in ${UNREADABLE_BASELINE}.`);
  process.exit(0);
}

const allowed = new Set(existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : []);
const failures = unresolved.filter((u) => !allowed.has(u.path));
const stale = [...allowed].filter((p) => !unresolved.some((u) => u.path === p));

const serviceAllowed = new Set(
  existsSync(SERVICE_ALLOWLIST) ? JSON.parse(readFileSync(SERVICE_ALLOWLIST, 'utf8')) : [],
);
const serviceFailures = serviceFindings.filter((f) => !serviceAllowed.has(f.id));

if (serviceFailures.length > 0) {
  console.error('Service-to-service calls that reach no declared route:');
  for (const f of serviceFailures)
    console.error(`  - ${f.id}
      ${f.detail}`);
  process.exit(1);
}

if (query.findings.length > 0) {
  console.error('Client query parameters no controller reads:');
  for (const f of query.findings) console.error(`  - ${f}`);
  process.exit(1);
}

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

/*
 * The ratchet. `unreadable` is the count of call sites whose verb this cannot read, so
 * whose method is NOT checked against the route. It was reported and never enforced.
 *
 * A ceiling rather than zero, because driving it to zero means rewriting how the client
 * builds those calls, and a gate that demands that today is a gate somebody deletes. What
 * it does buy: the number cannot grow by accident, and every drop is recorded deliberately.
 */
const ceiling = existsSync(UNREADABLE_BASELINE)
  ? JSON.parse(readFileSync(UNREADABLE_BASELINE, 'utf8')).unresolvedCallSites
  : Infinity;

console.log(
  `Endpoint contract check OK — ${clientPaths().size} client path(s), ${allowed.size} allowlisted, ` +
    `${calls.length} call site(s) method-matched, ${query.unreadable} runtime-built query string(s)` +
    (unreadable ? `, ${unreadable} call site(s) not statically resolvable` : '') +
    '.',
);

if (unreadable > ceiling) {
  console.error(
    `\n${unreadable} call site(s) cannot have their HTTP method checked — the recorded ` +
      `ceiling is ${ceiling}.`,
  );
  console.error(
    'An unresolvable call site is one where `api.<verb>(endpoints.a.b)` could not be read,\n' +
      'so nothing verifies the client and the controller agree on the verb. Write the call\n' +
      'in that shape, or lower the ceiling deliberately:\n' +
      '  node scripts/check-endpoint-contracts.mjs --update',
  );
  process.exit(1);
}
if (unreadable < ceiling && Number.isFinite(ceiling)) {
  console.log(
    `${ceiling - unreadable} call site(s) became readable since the ceiling was recorded — ` +
      'run with --update to lock the gain in.',
  );
}

if (stale.length > 0) {
  console.log('Allowlist entries that now resolve — run with --update to drop them:');
  for (const p of stale) console.log(`  - ${p}`);
}
console.log(
  `Service-to-service contract OK — ${outbound.length} inter-service call(s) across ` +
    `${new Set(outbound.map((c) => c.service)).size} service(s), ${serviceAllowed.size} allowlisted` +
    (outboundUnreadable.length
      ? `, ${outboundUnreadable.length} adapter path(s) not statically resolvable`
      : '') +
    '.',
);
for (const u of outboundUnreadable) console.log(`  ? ${u.file}: ${u.why}`);
const staleServiceCalls = [...serviceAllowed].filter(
  (id) => !serviceFindings.some((f) => f.id === id),
);
if (staleServiceCalls.length > 0) {
  console.log('Service-call allowlist entries that now resolve — run with --update to drop them:');
  for (const id of staleServiceCalls) console.log(`  - ${id}`);
}
