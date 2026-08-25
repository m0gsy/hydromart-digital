#!/usr/bin/env node
/**
 * Builds the static site that goes inside an Android binary.
 *
 *   node scripts/build-mobile.mjs             -> mobile-out/           (every route; the CI gate)
 *   node scripts/build-mobile.mjs customer    -> mobile-out-customer/  (id.hydromart.app)
 *   node scripts/build-mobile.mjs ops         -> mobile-out-ops/       (id.hydromart.ops)
 *
 * The two binaries carry different surfaces, and a route folder that is not there when
 * Next builds cannot end up in the APK. That is the whole mechanism: move the folders
 * this binary does not serve out of `src/app` for the duration of the build, then put
 * them back. Two facts make it safe, and both were checked rather than assumed:
 *
 *   - Nothing outside `src/app` imports from `src/app` at build time. Shared code lives
 *     in `src/components` and `src/lib`, so moving a route folder breaks no import. (Three
 *     files under `test/` do import pages — which is why a build must never run while a
 *     test run is in flight, and why the stash is restored before this script does
 *     anything else.)
 *   - `exceljs`, the heaviest thing in the tree, is reached only from `/dashboard`, `/hq`
 *     and `/hr` — through `components/csv-import.tsx` and four report pages, and from no
 *     customer page at all. Prune those and it falls out by itself; no dynamic import,
 *     no tricks.
 *
 * Moving source files around is the risky part, so the stash lives in the working tree
 * where `git status` can see it, and a run that finds a leftover stash puts it back
 * before doing anything else. If this ever dies in a way that skips both, the recovery
 * is `node scripts/build-mobile.mjs --restore` (or just move `.route-stash/*` back);
 * `--self-check` round-trips that logic against a throwaway tree.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const WEB = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const APP = join(WEB, 'src', 'app');
const STASH = join(WEB, '.route-stash');
const BUILT = join(WEB, 'mobile-out');

/**
 * Paths under `src/app` each binary does NOT serve, relative to `src/app`.
 *
 * Per-path, not per-top-level-folder: the Ops app keeps `/hr/me` (face check-in, payslip,
 * leave — the first thing every one of its four roles does each morning) while dropping
 * the rest of the HR console, and `hr/layout.tsx` has to stay behind or `/hr/me` loses
 * its shell. It returns early for that path and never renders the HR rail, so keeping it
 * costs a shell and gives away no console.
 */
const HR_CONSOLE_ONLY = () =>
  readdirSync(join(APP, 'hr'), { withFileTypes: true })
    .filter((e) => (e.isDirectory() ? e.name !== 'me' : e.name === 'page.tsx'))
    .map((e) => `hr/${e.name}`);

const TARGETS = {
  // Customers get the shop and their account. Everything staff-facing goes — including
  // `/resellers`, which sits at the top level rather than under `/hq` only so depot
  // managers can reach it, and is gated to canViewResellers.
  customer: () => ['hq', 'hr', 'dashboard', 'driver', 'm', 'resellers'],
  // Staff get every console they can actually reach. `/hq` is head-office, desktop-first,
  // and not in release 1 for either binary.
  ops: () => ['hq', ...HR_CONSOLE_ONLY()],
};

/**
 * What each binary must and must not serve, checked against the finished export.
 *
 * The prune list above says what to move; this says what the result has to look like.
 * They are not the same statement — a route that quietly grows a new home outside the
 * pruned folders would pass the first and fail this. Getting it wrong ships a customer
 * app carrying the depot cash book, so it is worth asserting rather than assuming.
 */
const SURFACES = {
  customer: {
    serves: ['products', 'orders/detail', 'checkout', 'account', 'hapus-akun', 'waralaba'],
    withholds: ['hq', 'hr', 'dashboard', 'driver', 'm', 'resellers'],
  },
  ops: {
    serves: ['driver/deliveries/detail', 'dashboard/walk-in', 'hr/me/check-in', 'm/manager'],
    withholds: ['hq', 'hr/payroll', 'hr/employees'],
  },
};

const target = process.argv[2];
if (target === '--self-check') {
  selfCheck();
  process.exit(0);
}
if (target === '--restore') {
  restore();
  console.log('stash restored');
  process.exit(0);
}
if (target && !TARGETS[target]) {
  console.error(`Unknown target "${target}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

/**
 * The prune list again, as route patterns the shipped bundle can read.
 *
 * A deep link can name a route this binary does not carry — a notification sent to a
 * phone whose owner has both apps, an old WhatsApp link, anything. In an exported build
 * that is not a page with stale data, it is a file that is not there, so the WebView
 * shows a blank screen with no way back. `deep-link.ts` needs to know which paths those
 * are, and this is the only place that knows: writing the list by hand in the client
 * would be the same list twice, drifting the first time a folder moves.
 *
 * A stashed directory becomes `/hq/*` — that route and everything under it. A stashed
 * `page.tsx` becomes the exact route only: Ops drops `/hr` itself while keeping `/hr/me`.
 */
function prunedRoutes(paths) {
  return paths.map((p) => (p.endsWith('.tsx') ? `/${dirname(p)}` : `/${p}/*`));
}

/**
 * J2 — the other half of the same question, and the half nothing answered.
 *
 * `prunedRoutes` names what this binary DROPPED. That covers a link to a screen this build
 * deliberately left out, and covers nothing else. The failure it cannot see is the opposite
 * one: a route the web has and this APK never had, because the APK was built before it
 * existed. Nobody pruned it — there was nothing to prune — so the resolver waves it
 * through, the router pushes at it, and an exported build has no file to serve. Blank
 * screen, no navigation left on it, and every source of such a link is outside our control:
 * a notification, a WhatsApp message, a link somebody saved.
 *
 * Top-level segments only, and that is the whole trick. It is one short string (a few
 * hundred bytes in an env var), it needs no maintenance, and it answers exactly the
 * question that goes wrong across a version skew — a whole new area of the app appearing.
 * A new SUB-page under an area this build already serves is a different and much rarer
 * shape, and is not claimed here.
 */
function servedSegments(app = APP) {
  return readdirSync(app, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    // Route groups `(name)` are not URL segments; their children are, one level down.
    .flatMap((e) => (/^\(.+\)$/.test(e.name) ? servedSegments(join(app, e.name)) : [e.name]))
    .sort();
}

/** Total bytes under `dir`, so the size claim in a PR description is measured, not guessed. */
function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : statSync(full).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Put every stashed path back where it came from. Safe to call when there is no stash. */
function restore(app = APP, stashRoot = STASH) {
  if (!existsSync(stashRoot)) return;
  for (const from of walkStash(stashRoot, app, stashRoot)) {
    const to = join(app, relative(stashRoot, from));
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
  rmSync(stashRoot, { recursive: true, force: true });
}

/**
 * The stashed paths themselves — the deepest entry that exists, not its contents.
 *
 * The distinction is why this recurses at all. `hr/payroll` is stashed while `hr/` is
 * not, so the stash holds an `hr/` to descend into and a `payroll/` to move back whole.
 * "Does this path still exist in src/app" is what tells the two apart.
 */
function walkStash(dir, app, stashRoot) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !existsSync(join(app, relative(stashRoot, full)))) out.push(full);
    else if (entry.isDirectory()) out.push(...walkStash(full, app, stashRoot));
    else out.push(full);
  }
  return out;
}

function stash(paths, app = APP, stashRoot = STASH) {
  for (const path of paths) {
    const from = join(app, path);
    if (!existsSync(from)) {
      console.error(`Nothing at src/app/${path} — the prune list is out of date.`);
      process.exit(1);
    }
    const to = join(stashRoot, path);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
}

/**
 * Round-trips the stash against a throwaway tree, because the branch a normal build
 * never exercises is the one that matters most: recovering a stash a dead run left
 * behind. Getting it wrong leaves source files outside src/app.
 *
 *   node scripts/build-mobile.mjs --self-check
 */
function selfCheck() {
  const root = mkdtempSync(join(tmpdir(), 'hm-stash-'));
  const app = join(root, 'app');
  const stashRoot = join(root, 'stash');
  const files = [
    'hq/page.tsx',
    'hr/layout.tsx',
    'hr/page.tsx',
    'hr/payroll/page.tsx',
    'hr/me/page.tsx',
  ];
  for (const f of files) {
    mkdirSync(dirname(join(app, f)), { recursive: true });
    writeFileSync(join(app, f), f);
  }

  // Exactly the Ops shape: a whole top-level folder, one nested folder, and one loose
  // file inside a folder that itself stays put.
  stash(['hq', 'hr/payroll', 'hr/page.tsx'], app, stashRoot);
  const kept = ['hq/page.tsx', 'hr/payroll/page.tsx', 'hr/page.tsx'].filter((f) =>
    existsSync(join(app, f)),
  );
  const lost = ['hr/layout.tsx', 'hr/me/page.tsx'].filter((f) => !existsSync(join(app, f)));

  restore(app, stashRoot);
  const wrong = files.filter((f) => readFileSync(join(app, f), 'utf8') !== f);
  const leftover = existsSync(stashRoot);
  rmSync(root, { recursive: true, force: true });

  const problems = [
    kept.length && `not stashed: ${kept.join(', ')}`,
    lost.length && `stashed but should have stayed: ${lost.join(', ')}`,
    wrong.length && `not restored: ${wrong.join(', ')}`,
    leftover && 'stash directory survived the restore',
  ].filter(Boolean);

  if (problems.length) {
    console.error(['self-check FAILED', ...problems].join('\n  '));
    process.exit(1);
  }
  console.log('self-check ok: stash and restore round-trip cleanly');
}

// Recover first: a previous run that died between stash and restore left source files
// out of the tree, and building on top of that would silently ship a smaller app.
restore();

const pruned = target ? TARGETS[target]() : [];
const outDir = target ? `${BUILT}-${target}` : BUILT;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restore();
    process.exit(1);
  });
}

let ok = false;
try {
  if (pruned.length) {
    console.log(`pruning ${pruned.length} path(s) for "${target}": ${pruned.join(', ')}`);
    stash(pruned);
  }
  rmSync(outDir, { recursive: true, force: true });
  // Next's own entry point, run by this Node — not `npx` through a shell, which on
  // Windows needs `shell: true` and then concatenates its arguments unescaped.
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
  execFileSync(process.execPath, [next, 'build'], {
    cwd: WEB,
    stdio: 'inherit',
    env: {
      ...process.env,
      MOBILE_BUILD: '1',
      MOBILE_OUT_DIR: relative(WEB, outDir),
      NEXT_PUBLIC_MOBILE_PRUNED: prunedRoutes(pruned).join(','),
      // J2. Computed AFTER the prune has stashed its folders, so it lists what this binary
      // actually carries rather than what the repo contains.
      NEXT_PUBLIC_MOBILE_SEGMENTS: servedSegments().join(','),
    },
  });
  ok = true;
} finally {
  restore();
}

if (!ok) process.exit(1);

const surface = SURFACES[target];
if (surface) {
  const missing = surface.serves.filter((r) => !existsSync(join(outDir, r, 'index.html')));
  const leaked = surface.withholds.filter((r) => existsSync(join(outDir, r)));
  if (missing.length || leaked.length) {
    if (missing.length) console.error(`"${target}" is missing routes it must serve: ${missing.join(', ')}`);
    if (leaked.length) console.error(`"${target}" still ships routes it must not: ${leaked.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Every literal route the app navigates to must exist in THIS export.
 *
 * `SURFACES` above checks the route SET; it says nothing about link TARGETS, and that gap
 * shipped: `require-auth` sent every expired console session to `/hq/login`, a route the Ops
 * binary prunes wholesale. Sign-out did the same. The tap landed on a file that is not in the
 * bundle — no error, no door, no way back in — and no check here could see it, because the set
 * of exported routes was exactly right.
 *
 * Only literals are checked. A path built at runtime (`consoleHome(role)`, a `?id=` detail
 * link) cannot be read statically; `lib/roles.ts` and `lib/deep-link.ts` guard those against
 * the same prune list at runtime instead.
 */
/**
 * `livesUnder` is the surface a file can only ever be rendered from. When THAT surface is
 * pruned the file goes with it, and its links are unreachable rather than broken — the HQ
 * rail pointing at `/hq/depots` in the customer binary is not a dead tap, it is a rail
 * nobody in that binary can reach. Scanning it anyway reported 60 "dead" links per build
 * and would have trained everyone to ignore this check.
 *
 * `null` means the file survives in every binary, and those are the ones that mattered:
 * `require-auth` and `console-sign-out` are exactly where the Ops door died.
 *
 * `lib/roles.ts` and `lib/deep-link.ts` are deliberately NOT here. They are the prune-aware
 * helpers this check tells you to route through — their literals ARE the prune table, so
 * scanning them flags the mechanism as the defect. Their behaviour is pinned by unit tests
 * (`test/roles.test.ts`, `test/deep-link.test.ts`) against the same env var instead.
 */
/**
 * Read off the filesystem rather than typed out. The hand-kept list named nine files and
 * missed `driver-shell.tsx` and `manager-shell.tsx` — the two bottom navs of the ENTIRE
 * Ops binary, so the one check that exists to catch a tap into nothing was blind to the
 * whole courier and manager surface. Anything that navigates is a `*-shell`, `*-nav` or
 * `*-rail`; those three suffixes are the naming convention this codebase already keeps.
 */
const NAV_FILES = (function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collect(p, out);
    else if (/-(shell|nav|rail)\.tsx$/.test(entry.name))
      out.push(relative(WEB, p).split(sep).join('/'));
  }
  return out;
})(join(WEB, 'src', 'components'));

/** Which subtree a nav belongs to, so a pruned console's own nav is not scanned. */
const livesUnderOf = (rel) =>
  rel.includes('/hq/') ? '/hq' : rel.includes('/hr/') ? '/hr' : rel.includes('/dashboard/') || rel.includes('/operator/') ? '/dashboard' : rel.includes('/driver/') ? '/driver' : rel.includes('/manager-mobile/') ? '/m' : null;

const NAV_SOURCES = [
  { rel: 'src/components/require-auth.tsx', livesUnder: null },
  { rel: 'src/components/console-sign-out.tsx', livesUnder: null },
  ...NAV_FILES.map((rel) => ({ rel, livesUnder: livesUnderOf(rel) })),
];
const served = (route) =>
  existsSync(join(outDir, route, 'index.html')) || existsSync(join(outDir, `${route}.html`));
const dead = [];
for (const { rel, livesUnder } of NAV_SOURCES) {
  const file = join(WEB, rel);
  if (!existsSync(file)) continue;
  if (livesUnder && !served(livesUnder)) continue;
  const text = readFileSync(file, 'utf8');
  for (const [, route] of text.matchAll(/['"`](\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)['"`]/gi)) {
    const clean = route.replace(/\/+$/, '');
    if (served(clean)) continue;
    // A literal the file itself gates on `isServedHere('<that exact route>')` cannot be
    // tapped into nothing. The guard has to name the very route it protects, so it cannot
    // drift away from that link the way a general "trust me" marker would.
    if (text.includes(`isServedHere('${clean}')`)) continue;
    dead.push(`${rel} -> ${clean}`);
  }
}
const deadOnce = [...new Set(dead)];
if (deadOnce.length > 0) {
  console.error(`\n"${target}" navigates to ${deadOnce.length} route(s) it does not serve:`);
  for (const d of deadOnce) console.error(`  - ${d}`);
  console.error('\nEither keep the route in this binary, or route through a prune-aware helper');
  console.error('(`staffDoor` / `consoleHome` in lib/roles.ts, `resolveDeepLink` in lib/deep-link.ts).');
  process.exit(1);
}

const pages = countHtml(outDir);
console.log(`\n${relative(WEB, outDir)}: ${pages} pages, ${mb(sizeOf(outDir))}`);

function countHtml(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countHtml(join(dir, entry.name));
    else if (entry.name.endsWith('.html')) n += 1;
  }
  return n;
}
