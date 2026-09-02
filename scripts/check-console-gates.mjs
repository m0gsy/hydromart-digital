#!/usr/bin/env node
/**
 * Does the door agree with the lock?
 *
 *   node scripts/check-console-gates.mjs [--update]
 *
 * The /hq rail decides which links a role is offered, and — since step 07 of the console
 * audit — `capForHqPath` makes the same table decide which PAGES that role may open. Both
 * read one field: `cap` on the rail item. So `cap` is now an access rule, and an access
 * rule that names the wrong capability is worse than none: it looks enforced.
 *
 * That is not hypothetical. Three items shipped with a `cap` that was not the capability
 * the server checks on the page's own requests:
 *
 *   /hq/roster     gated `tracking`       — delivery-service checks `driverRoster`
 *   /hq/campaigns  gated `audienceReach`  — crm-service checks `campaignRead`
 *   /hq/onboarding gated `platformAdmin`  — depot-service checks `depotDirectory`
 *
 * `tracking` is a depot capability that NO head-office role holds, so the courier roster
 * was invisible to head office and to the director — both of whom the server serves. The
 * rail was answering a different question from the server and nothing compared the two.
 *
 * This compares them. For every rail item that declares a `cap`, it resolves the page's
 * `endpoints.x.y` references to real controller routes, reads the `@Can` on each, and
 * requires the declared capability to be one of them. Items with no `cap` are counted
 * against a baseline that may only go down — 61 doors do not get gates in one commit, and
 * a number that can only shrink is how the rest arrive.
 *
 * Exit 0 = the declared gates all match and the ungated count is at or under the baseline.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The nav MODEL, not the component that renders it. Step 07b split them so `lib/roles.ts`
// could answer "where does this role land" from the same table, without importing a React
// component into lib.
const RAIL = 'apps/web/src/lib/hq-nav.ts';
const APP = 'apps/web/src/app';
const CLIENT_DIR = 'apps/web/src/lib/endpoints';
const BASELINE = 'scripts/console-gates-baseline.json';
const update = process.argv.includes('--update');
const NEWLINE = String.fromCharCode(10);
// `key: (args) =>` wrapped onto the next line by Prettier.
// `x${...}` where x is not `/` — a query builder glued onto the end of a path.
const QUERY_INTERP = /\$\{.*$/;
const PATH_INTERP = /\/\$\{[^}]*\}/g;
const ARROW_WRAP = new RegExp('=>' + String.fromCharCode(92) + 's*' + String.fromCharCode(92) + 'n' + String.fromCharCode(92) + 's*', 'g');

// ---------------------------------------------------------------- the rail items

function railItems() {
  const text = readFileSync(RAIL, 'utf8');
  const items = [];
  for (const m of text.matchAll(/\{\s*href: '([^']+)',\s*labelKey: '([^']+)'[^}]*\}/g)) {
    if (!/ready: true/.test(m[0])) continue;
    items.push({ href: m[1], cap: /cap: '([^']+)'/.exec(m[0])?.[1] ?? null });
  }
  return items;
}

// ------------------------------------------------------- endpoints.x.y → API path

/**
 * The same walk `check-endpoint-contracts.mjs` uses: track the key stack by brace depth
 * and record every leaf whose value starts with `/segment/api/v1/`. Registered under every
 * suffix of its key path, because call sites write `endpoints.hq.rollup` while the table
 * nests it under a group.
 */
function clientPaths() {
  const paths = new Map();
  for (const entry of readdirSync(CLIENT_DIR).filter((f) => f.endsWith('.ts'))) {
    /*
     * A builder wrapped by Prettier is still a builder. `customerLookup: (phone) =>`
     * and its template literal live on two lines, and a line-by-line matcher sees a
     * key with no path — which is why /hq/customers looked ungated when it is not.
     * Joining a line that ends in `=>` with the next puts them back together.
     */
    const text = readFileSync(join(CLIENT_DIR, entry), 'utf8').replace(ARROW_WRAP, '=> ');
    const stack = [];
    let depth = 0;
    /** The block-bodied builder whose `return` we are still looking for. */
    let pending = null;
    const record = (trail, path) => {
      for (let i = 0; i < trail.length - 1; i += 1) {
        const key = trail.slice(i).join('.');
        if (!paths.has(key)) paths.set(key, path);
      }
    };
    for (const line of text.split('\n')) {
      const open = line.match(/([a-zA-Z0-9_]+):\s*\{\s*$/);
      const leaf = line.match(
        /([a-zA-Z0-9_]+):\s*(?:\([^)]*\)\s*=>\s*)?['`](\/[a-z-]+\/api\/v1\/[^'`\s]*)/i,
      );
      /*
       * `key: (q) => { … return `/x/api/v1/y${qs}`; }`.
       *
       * A third of this table is written that way, and reading only single-expression
       * builders left those paths unknown — which reads as "this page needs no capability"
       * and is how /hq/pricing, /hq/compare and /hq/forecast came back as gates naming a
       * capability the server does not check, when the endpoint that proves them sits in a
       * block body.
       *
       * The key is remembered from the line that OPENS the builder, which is not always the
       * line that opens the block: `demand: (q: {` … `}) => {` wraps its parameter type over
       * five lines. So the match is on `key: (` and nothing more.
       */
      const builder = line.match(/([a-zA-Z0-9_]+):\s*\(/);
      const returned = line.match(/return\s+['`](\/[a-z-]+\/api\/v1\/[^'`\s]*)/i);
      if (leaf && stack.length > 0) record([...stack, leaf[1]], leaf[2]);
      if (builder && !leaf) pending = builder[1];
      if (returned && pending) {
        // Trailing nulls are the anonymous braces of the builder's own parameter type,
        // not namespace levels — a key trail with a hole in it matches nothing.
        const named = [...stack];
        while (named.length && named[named.length - 1] === null) named.pop();
        record([...named, pending], returned[1]);
        pending = null;
      }
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      // `demand: (q: {` opens a PARAMETER TYPE, not a namespace — and `q: {` is what the
      // key-opening pattern finds on that line, which registered the path under
      // `forecast.q.demand` and left `forecast.demand` unknown.
      if (open && !builder && opens === 1 && closes === 0) stack.push(open[1]);
      else if (opens > closes) stack.push(null);
      depth += opens - closes;
      for (let i = 0; i < closes - opens; i += 1) stack.pop();
      if (depth <= 0) stack.length = 0;
    }
  }
  return paths;
}

// ------------------------------------------------------------- API path → @Can(x)

function controllers(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) controllers(p, out);
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function serverRoutes() {
  const routes = [];
  for (const svc of readdirSync('services', { withFileTypes: true })) {
    if (!svc.isDirectory()) continue;
    const src = join('services', svc.name, 'src');
    if (!existsSync(src)) continue;
    for (const file of controllers(src)) {
      const whole = readFileSync(file, 'utf8');
      /*
       * One file, one controller — except when it is two.
       *
       * `price-override.controller.ts` declares a depot-scoped controller and, below it, the
       * head-office one at `price-overrides` carrying `@Can('priceOverrideDecide')` on the
       * CLASS. Reading "the text before the first `export class`" attributes every route in
       * the file to the first controller's base path and the first class's capability, so
       * the HQ queue resolved to nothing and /hq/pricing looked like a gate naming a
       * capability the server does not check. Split on the class boundaries instead.
       */
      const wholeLines = whole.split(NEWLINE);
      const lineStart = [];
      {
        let at = 0;
        for (const l of wholeLines) {
          lineStart.push(at);
          at += l.length + 1;
        }
      }
      /** Back up over the whole decorator block above a class, not just its last line. */
      const decoratorTop = (charIndex) => {
        let row = lineStart.findIndex(
          (o, i) => o <= charIndex && (i + 1 === lineStart.length || lineStart[i + 1] > charIndex),
        );
        while (row > 0) {
          const prev = wholeLines[row - 1].trim();
          // `@Can` sits ABOVE `@Controller` in this codebase, with `@ApiTags` and
          // `@ApiBearerAuth` above that. Stopping at the first `@` line found the
          // controller and missed the capability.
          if (prev === '' || prev.startsWith('}') || prev.startsWith(';')) break;
          row -= 1;
        }
        return lineStart[row];
      };
      const starts = [...whole.matchAll(/^export class /gm)].map((m) => m.index);
      const chunks = starts.length
        ? starts.map((s, i) => {
            // Include the decorator block above the class: that is where @Controller and a
            // class-level @Can live.
            const from = i === 0 ? 0 : Math.max(starts[i - 1], decoratorTop(s));
            return whole.slice(from, starts[i + 1] ?? whole.length);
          })
        : [whole];
      for (const body of chunks) {
      const base =
        /@Controller\(\{?\s*path:\s*'([^']*)'/.exec(body)?.[1] ??
        /@Controller\('([^']*)'/.exec(body)?.[1] ??
        '';
      // A class-level @Can applies to every route in ITS class, and sits above the class
      // declaration — further than any per-route lookback would reach.
      const head = body.slice(0, Math.max(0, body.indexOf('export class')));
      const classCan = [...head.matchAll(/@Can\('([^']+)'\)/g)].pop()?.[1] ?? null;
      /*
       * `@Can` is read from the route's whole DECORATOR RUN, not from the text before it.
       *
       * Nest decorators have no required order, and this codebase writes both — some
       * routes carry `@Can` above `@Get`, others below it, with `@ApiOperation` and a
       * comment in between. A backwards-only lookback therefore picks up the PREVIOUS
       * route's capability, which is how `/hq/refunds` was reported as mismatched when
       * it was right: `refunds/queue` has its `@Can('refundQueueRead')` on the line after
       * `@Get`, so the scan found the one belonging to the route above it.
       */
      const lines = body.split(NEWLINE);
      const offsets = [];
      let at = 0;
      for (const line of lines) {
        offsets.push(at);
        at += line.length + 1;
      }
      for (const m of body.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*'?([^')]*)'?\s*\)/g)) {
        let row = offsets.findIndex((o, i) => o <= m.index && (i + 1 === offsets.length || offsets[i + 1] > m.index));
        // Up: through decorators and the comments between them, stopping at the blank line
        // or the `}` that ends whatever came before.
        let top = row;
        while (top > 0) {
          const prev = lines[top - 1].trim();
          if (prev === '' || prev.startsWith('}')) break;
          top -= 1;
        }
        // Down: through the rest of the run, stopping once the method signature is passed.
        let bottom = row;
        while (bottom + 1 < lines.length) {
          const next = lines[bottom + 1].trim();
          if (next === '') break;
          bottom += 1;
          if (!next.startsWith('@') && !next.startsWith('*') && !next.startsWith('//') && !next.startsWith(')')) break;
        }
        const run = lines.slice(top, bottom + 1).join(NEWLINE);
        const can = /@Can\('([^']+)'\)/.exec(run)?.[1] ?? classCan;
        const sub = (m[2] ?? '').replace(/^\/+/, '');
        routes.push({
          path: `/api/v1/${base}${sub ? `/${sub}` : ''}`.replace(/\/+/g, '/'),
          can,
        });
      }
      }
    }
  }
  return routes;
}

/**
 * `${id}` and `:id` are the same hole; a trailing slash is not a difference.
 *
 * An interpolation that does NOT follow a slash is a query-string builder, not a path
 * segment — `…/forecast/churn${insightQuery(q)}` is the route `…/forecast/churn`. Treating
 * it as a segment invented a route nobody serves, which is why /hq/churn read as gated on
 * a capability "the server does not check" when `@Can('churn')` is written right there.
 */
const shape = (p) =>
  p
    // `/${id}` is a path segment. Anything else interpolated is a query builder glued to
    // the end — and it may have no closing brace at all, because the capture stops at the
    // first space inside `${qs ? `?${qs}` : ''}`. Cutting from `${` to the end covers both.
    .replace(PATH_INTERP, '/:x')
    .replace(QUERY_INTERP, '')
    .replace(/:[a-zA-Z][a-zA-Z0-9_]*/g, ':x')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

// --------------------------------------------------------------------- the check

const items = railItems();
const paths = clientPaths();
const routes = serverRoutes();

/**
 * `--why /hq/pricing` prints how one item's capability set was arrived at: every
 * `endpoints.x.y` on the page, the path it resolved to, and the routes that matched. Every
 * wrong answer this gate has given traced back to one of those three steps, and reading it
 * from the outside took a debug harness each time.
 */
const WHY = process.argv.includes('--why') ? process.argv[process.argv.indexOf('--why') + 1] : null;

function capsFor(pageFile, why = false) {
  const text = readFileSync(pageFile, 'utf8');
  const caps = new Set();
  let resolved = 0;
  for (const m of text.matchAll(/endpoints\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){1,2})/g)) {
    const clientPath = paths.get(m[1]);
    if (why) {
      const t = clientPath ? shape(clientPath.replace(/^\/[a-z-]+/, '').split('?')[0]) : null;
      const hit = t ? routes.filter((r) => shape(r.path) === t) : [];
      console.log(
        `   endpoints.${m[1]} → ${clientPath ?? '(no client path)'} → ${t ?? '-'} → ` +
          (hit.length ? hit.map((h) => h.can ?? '(no @Can)').join(', ') : '(no route matched)'),
      );
    }
    if (!clientPath) continue;
    const target = shape(clientPath.replace(/^\/[a-z-]+/, '').split('?')[0]);
    const hits = routes.filter((r) => shape(r.path) === target);
    if (hits.length) resolved += 1;
    for (const h of hits) if (h.can) caps.add(h.can);
  }
  return { caps: [...caps], resolved };
}

const pageOf = (href) => {
  const file = join(APP, href.replace(/^\//, ''), 'page.tsx');
  return existsSync(file) ? file : null;
};

if (process.argv.includes('--keys')) {
  const pat = process.argv[process.argv.indexOf('--keys') + 1] ?? '';
  for (const [k, v] of paths) if (k.includes(pat)) console.log(k, '→', v);
  process.exit(0);
}

if (WHY) {
  const file = pageOf(WHY);
  if (!file) {
    console.error(`no page file for ${WHY}`);
    process.exit(2);
  }
  console.log(`${WHY}:`);
  const { caps } = capsFor(file, true);
  console.log(`   => ${caps.join(', ') || '(nothing resolved)'}`);
  process.exit(0);
}

const mismatched = [];
const ungated = [];
for (const item of items) {
  const file = pageOf(item.href);
  if (!file) continue;
  const { caps, resolved } = capsFor(file);
  if (!item.cap) {
    if (caps.length) ungated.push(`${item.href} (server wants: ${caps.join(', ')})`);
    continue;
  }
  // Nothing resolved means the page builds its paths some way this cannot read — an
  // absence of evidence, not evidence the gate is wrong.
  if (resolved === 0 || caps.length === 0) continue;
  if (!caps.includes(item.cap)) {
    mismatched.push(`${item.href} declares '${item.cap}', server checks ${caps.join(', ')}`);
    continue;
  }
  /*
   * A second rule was tried here and removed: "a cap no console role holds must be the only
   * capability the page needs". It caught `/hq/roster` (gated `tracking`, which no HQ role
   * holds, over a page whose driver list the server serves to head office) — and it also
   * flagged every write form, because a form reads with a broad capability and writes with
   * a narrow one, which is correct and deliberate. A rule that is right about one door and
   * wrong about four is not a gate; it is a thing people learn to silence.
   *
   * What the roster case needed instead is an assertion about the OUTCOME, and it lives in
   * `apps/web/test/hq-rail-gating.test.ts`: head office is offered /hq/roster. Restore the
   * old `tracking` gate and that test goes red, by name.
   */
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { ungated: ungated.length };

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify({ ungated: ungated.length }, null, 2)}\n`);
  console.log(`console gates: baseline written — ${ungated.length} ungated item(s).`);
  process.exit(0);
}

let failed = false;
if (mismatched.length) {
  failed = true;
  console.error(`console gates: ${mismatched.length} rail item(s) name the wrong capability\n`);
  for (const line of mismatched) console.error(`   ${line}`);
  console.error('\n   The rail hides the link AND the layout refuses the page on this value.');
  console.error('   Naming a capability the server does not check means one of the two is a lie.');
}

if (process.argv.includes('--list')) {
  for (const line of ungated) console.log(`   ungated: ${line}`);
}

if (ungated.length > baseline.ungated) {
  failed = true;
  console.error(
    `\nconsole gates: ${ungated.length} ungated item(s), baseline ${baseline.ungated} — this may only go down.\n`,
  );
  for (const line of ungated) console.error(`   ${line}`);
}

if (failed) process.exit(1);

if (ungated.length < baseline.ungated) {
  console.log(
    `console gates OK — ${items.length} rail item(s), 0 mismatched, ${ungated.length} ungated ` +
      `(baseline ${baseline.ungated}; run with --update to lower it).`,
  );
} else {
  console.log(
    `console gates OK — ${items.length} rail item(s), 0 mismatched, ${ungated.length} ungated (baseline ${baseline.ungated}).`,
  );
}
