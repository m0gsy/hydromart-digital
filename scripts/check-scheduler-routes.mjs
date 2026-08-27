#!/usr/bin/env node
/**
 * Every scheduled sweep must resolve to a route that exists and that the scheduler can
 * actually authenticate to.
 *
 *   node scripts/check-scheduler-routes.mjs
 *
 * Nothing checked this. `scripts/scheduler/sweep.sh` POSTs
 * `http://<host>/api/v1/<path>` with an `x-internal-key` header, and a path that resolves
 * to nothing — a typo, a controller prefix that moved, a route that was never given an
 * internal-auth door — fails at runtime, every tick, into a container log. The failure
 * alert needs ALERT_WEBHOOK_URL to be set to reach anybody, and the sweep that is not
 * running looks exactly like the sweep with nothing to do.
 *
 * That is not hypothetical. PAR-05 (birthday points, FR-091) and PAR-01 (point expiry,
 * BR-014) were both fully built, tested, idempotent — and their only routes were
 * `@Roles(SUPER_ADMIN)`, i.e. they needed a human's JWT. The scheduler has none. So both
 * features were worth exactly zero in production and nothing anywhere said so.
 *
 * Three things are asserted per crontab line:
 *   1. the path resolves to a route in that service's controllers
 *   2. that route is a POST (sweep.sh only posts)
 *   3. that route accepts the internal key — UseGuards(InternalAuthGuard), not @Roles
 *
 * Exit 0 = every scheduled sweep is reachable; 1 = at least one is not.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: a URL percent-encodes, so a checkout under a path with a
// space in it ("IDEAPAD SLIM 3") resolves to a directory that does not exist. The repo path
// happens to have none; the temp directory this file's own self-check runs in does.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CRONTAB = join(ROOT, 'scripts/scheduler/crontab');
const SERVICES = join(ROOT, 'services');

/** `sh /scripts/sweep.sh <path> [host:port]` — the only shape crond invokes. */
function scheduledSweeps() {
  const out = [];
  const lines = readFileSync(CRONTAB, 'utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    if (line.trimStart().startsWith('#')) continue;
    const m = line.match(/sweep\.sh\s+(\S+)(?:\s+(\S+))?\s*$/);
    if (!m) continue;
    const host = (m[2] ?? 'order:3004').split(':')[0];
    out.push({ line: i + 1, path: m[1], host });
  }
  return out;
}

/**
 * Every POST route a service declares, as `{ path, internal }`.
 *
 * Deliberately a regex pass over the source rather than anything that boots Nest: this
 * runs in CI with no database, no build, and no container. The decorator discipline that
 * makes 697 routes machine-readable is what lets it work.
 */
function postRoutes(serviceDir) {
  const modules = join(serviceDir, 'src/modules');
  if (!existsSync(modules)) return [];
  const routes = [];
  for (const file of readdirSync(modules).filter((f) => f.endsWith('.controller.ts'))) {
    const src = readFileSync(join(modules, file), 'utf8');
    const prefix = src.match(/@Controller\(\{[^}]*?path:\s*'([^']*)'/)?.[1] ?? '';
    // Class-level guards apply to every route in the file.
    const classGuardsInternal = /@Controller\(/.test(src)
      ? /@UseGuards\([^)]*InternalAuthGuard[^)]*\)[\s\S]{0,200}?@Controller\(/.test(src)
      : false;
    // A route's decorators surround its @Post on BOTH sides — Nest does not care about
    // order, and this repo writes @UseGuards below @Post as often as above. The first
    // version of this check only looked upward and reported hr announcements/publish-due
    // as unguarded when its @UseGuards(InternalAuthGuard) sits two lines under the @Post.
    //
    // So the block for a route is everything between the PREVIOUS method signature and the
    // NEXT one: exactly the decorator run that belongs to it, whichever side it is written.
    const signatures = [...src.matchAll(/^ {2}(?:async )?[A-Za-z_$][\w$]*\s*\(/gm)].map(
      (m) => m.index,
    );
    for (const m of src.matchAll(/@Post\(\s*'([^']*)'\s*\)/g)) {
      const full = [prefix, m[1]].filter(Boolean).join('/');
      const start = signatures.filter((i) => i < m.index).pop() ?? 0;
      const end = signatures.find((i) => i > m.index) ?? src.length;
      const block = src.slice(start, end);
      routes.push({
        file,
        path: full,
        internal: classGuardsInternal || /InternalAuthGuard/.test(block),
      });
    }
  }
  return routes;
}

/** A `:param` segment matches any single segment; everything else is literal. */
function matches(routePath, wantedPath) {
  const a = routePath.split('/');
  const b = wantedPath.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

const sweeps = scheduledSweeps();
if (sweeps.length === 0) {
  console.error('FAIL: no sweep lines parsed out of scripts/scheduler/crontab');
  process.exit(1);
}

const cache = new Map();
let failed = 0;

for (const sweep of sweeps) {
  const dir = join(SERVICES, `${sweep.host}-service`);
  if (!existsSync(dir)) {
    console.error(`  X crontab:${sweep.line} ${sweep.path} -> no such service "${sweep.host}-service"`);
    failed += 1;
    continue;
  }
  if (!cache.has(dir)) cache.set(dir, postRoutes(dir));
  const hit = cache.get(dir).filter((r) => matches(r.path, sweep.path));
  if (hit.length === 0) {
    console.error(
      `  X crontab:${sweep.line} ${sweep.host}: POST /api/v1/${sweep.path} resolves to no route — this sweep fails every tick`,
    );
    failed += 1;
    continue;
  }
  if (!hit.some((r) => r.internal)) {
    console.error(
      `  X crontab:${sweep.line} ${sweep.host}: ${sweep.path} exists (${hit[0].file}) but has no InternalAuthGuard — sweep.sh sends x-internal-key and has no JWT, so every tick is a 401/403`,
    );
    failed += 1;
    continue;
  }
  console.log(`  . ${sweep.host}: ${sweep.path}`);
}

console.log('');
if (failed > 0) {
  console.error(`FAIL — ${failed} of ${sweeps.length} scheduled sweep(s) cannot run.`);
  process.exit(1);
}
console.log(`scheduler routes OK — ${sweeps.length} scheduled sweep(s) resolve and accept the internal key.`);
