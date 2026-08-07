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
 * is `node scripts/build-mobile.mjs --restore` (or just move `.route-stash/*` back).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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
if (target === '--restore') {
  restore();
  console.log('stash restored');
  process.exit(0);
}
if (target && !TARGETS[target]) {
  console.error(`Unknown target "${target}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
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
function restore() {
  if (!existsSync(STASH)) return;
  for (const from of walkStash(STASH)) {
    const to = join(APP, relative(STASH, from));
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
  rmSync(STASH, { recursive: true, force: true });
}

/** The stashed paths themselves — the deepest entry that exists, not its contents. */
function walkStash(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // A stashed route folder is restored whole; a directory that only exists to hold one
    // (`hr/` holding `hr/payroll`) is descended into.
    if (entry.isDirectory() && !existsSync(join(APP, relative(STASH, full)))) out.push(full);
    else if (entry.isDirectory()) out.push(...walkStash(full));
    else out.push(full);
  }
  return out;
}

function stash(paths) {
  for (const path of paths) {
    const from = join(APP, path);
    if (!existsSync(from)) {
      console.error(`Nothing at src/app/${path} — the prune list is out of date.`);
      process.exit(1);
    }
    const to = join(STASH, path);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
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
    env: { ...process.env, MOBILE_BUILD: '1', MOBILE_OUT_DIR: relative(WEB, outDir) },
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
