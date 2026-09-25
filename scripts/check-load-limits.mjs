#!/usr/bin/env node
/**
 * The load test must run under the limits production runs under.
 *
 *   node scripts/check-load-limits.mjs
 *
 * `docker-compose.load-limits.yml` holds the load stack to production's resource shape (512 MB / 1 CPU
 * per service, connection_limit=5 on every Prisma pool, postgres at 2 GB and max_connections=150).
 * It is only worth having if it stays complete: a service added to docker-compose.test.yml and not
 * to the overlay silently runs unbounded again, and the capacity number is a number about a
 * different system. So this requires, from the two files themselves:
 *   1. every service in docker-compose.test.yml appears in the overlay with a mem_limit and cpus;
 *   2. every `*_DATABASE_URL` in docker-compose.test.yml is overridden with connection_limit=5;
 *   3. postgres is bounded;
 *   4. .github/workflows/load.yml actually layers the overlay in.
 * Exit 0 = the load stack is held to production's limits.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.HYDROMART_ROOT ?? process.cwd();
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');

const test = read('docker-compose.test.yml');
const overlay = read('docker-compose.load-limits.yml');
const load = read('.github/workflows/load.yml');

/** Top-level `services:` keys of a compose file. */
function services(text) {
  const out = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^services:/.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^[a-z]/.test(line)) break;
    const m = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (inside && m) out.push(m[1]);
  }
  return out;
}

/** The body of one service block (from its key to the next sibling). */
function block(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z0-9-]+:\s*$/.test(lines[i]) || /^[a-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

const problems = [];
if (!overlay) problems.push('docker-compose.load-limits.yml is missing');

for (const svc of services(test)) {
  const b = block(overlay, svc);
  if (!/mem_limit:\s*\S+/.test(b) || !/cpus:\s*\S+/.test(b)) {
    problems.push(
      `service "${svc}" in docker-compose.test.yml has no mem_limit + cpus in the overlay`,
    );
  }
}

for (const key of [...test.matchAll(/^\s+([A-Z]+_DATABASE_URL):/gm)].map((m) => m[1])) {
  const line = overlay.split('\n').find((l) => l.trim().startsWith(`${key}:`)) ?? '';
  if (!/connection_limit=5\b/.test(line)) {
    problems.push(`${key} is not overridden with connection_limit=5 in the overlay`);
  }
}

const pg = block(overlay, 'postgres');
if (!/mem_limit:\s*2g/.test(pg) || !/max_connections=150/.test(pg)) {
  problems.push(
    'postgres in the overlay must carry mem_limit: 2g and max_connections=150, as production does',
  );
}

if (!load.includes('docker-compose.load-limits.yml')) {
  problems.push(
    '.github/workflows/load.yml does not layer docker-compose.load-limits.yml (COMPOSE_EXTRA_FILES)',
  );
}

if (problems.length > 0) {
  console.error(`${problems.length} gap(s) between the load stack and production's limits:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  'check-load-limits: the load stack is held to production limits (memory, cpu, pool, postgres)',
);
