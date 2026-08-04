#!/usr/bin/env node
/**
 * Audit CI-3: `npm ci` runs 16 `postinstall` hooks, one per service with a Prisma schema,
 * and every one of them regenerates a client that is usually already correct. CI installs
 * three times, so that is ~48 generates per run for a schema set that changed in at most
 * one place — minutes of wall-clock spent producing files identical to the ones on disk.
 *
 * The staleness key is a hash of the schema plus the CLI version, written into the output
 * directory by this script. Prisma's own copy of the schema cannot be used: it re-formats
 * it on the way out, so a byte comparison never matches even when nothing changed.
 *
 * Runs from a service directory (that is where `postinstall` runs). Falls through to a
 * real generate whenever it cannot prove the client is current — being wrong in the cheap
 * direction costs seconds; being wrong in the other direction ships a stale client.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SCHEMA = join('prisma', 'schema.prisma');
const GENERATED = join('prisma', 'generated', 'client');
const CLIENT = join(GENERATED, 'index.js');
const STAMP = join(GENERATED, '.generated-from');

/**
 * The installed Prisma CLI. Resolved to its entry script and run with `node` rather than
 * through `npx`: npx re-resolves the package on every call, and on Windows it is a .cmd
 * shim that spawnSync cannot launch without a shell.
 */
function cliPackageDir() {
  const rel = join('node_modules', 'prisma');
  for (const candidate of [rel, join('..', '..', rel)]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/** Version from the installed package — `prisma --version` costs as much as a generate. */
function cliVersion() {
  const dir = cliPackageDir();
  if (!dir) return 'unknown';
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
}

const key = () =>
  `${createHash('sha256').update(readFileSync(SCHEMA)).digest('hex')} prisma@${cliVersion()}`;

function generate() {
  const dir = cliPackageDir();
  if (!dir) {
    console.error('prisma CLI not installed — cannot generate the client');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [join(dir, 'build', 'index.js'), 'generate'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  try {
    writeFileSync(STAMP, `${key()}\n`);
  } catch {
    // A missing stamp only costs the next install one generate — never a wrong client.
  }
}

// Not a Prisma service, or the schema was not copied into this build context.
if (!existsSync(SCHEMA)) process.exit(0);

if (!existsSync(CLIENT) || !existsSync(STAMP) || readFileSync(STAMP, 'utf8').trim() !== key()) {
  generate();
} else {
  console.log(`prisma client up to date (${basename(process.cwd())}) — skipping generate`);
}
