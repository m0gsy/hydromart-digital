#!/usr/bin/env node
/**
 * Prepare the Android project for one of the two binaries.
 *
 *   node scripts/sync.mjs customer
 *   node scripts/sync.mjs ops
 *
 * Deliberately refuses to run when the export it is about to copy does not exist. The
 * failure it prevents is the expensive one: `cap sync` happily copies an empty or stale
 * `webDir`, and the result is a signed AAB that installs, opens to a white screen, and
 * looks like a runtime bug rather than a missing build step.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = {
  customer: '../apps/web/mobile-out-customer',
  ops: '../apps/web/mobile-out-ops',
};

const target = process.argv[2];
if (!Object.hasOwn(TARGETS, target ?? '')) {
  console.error(`Usage: node scripts/sync.mjs <${Object.keys(TARGETS).join('|')}>`);
  process.exit(1);
}

const webDir = resolve(ROOT, TARGETS[target]);
if (!existsSync(join(webDir, 'index.html'))) {
  console.error(`No export at ${webDir}.`);
  console.error(`Build it first:  npm run build:mobile ${target} --workspace @hydromart/web`);
  process.exit(1);
}

// An export with no `_next` directory is one that was interrupted mid-copy; it still has
// an index.html, so the check above would pass and the app would boot to an unstyled,
// scriptless page.
if (!readdirSync(webDir).includes('_next')) {
  console.error(`Export at ${webDir} has no _next/ — it is incomplete. Rebuild it.`);
  process.exit(1);
}

execFileSync('npx', ['cap', 'sync', 'android'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, MOBILE_APP: target },
});

console.log(`\nSynced the ${target} export into android/. Build it with:`);
console.log(
  `  cd android && ./gradlew bundleRelease -PhydromartAppId=${target === 'ops' ? 'id.hydromart.ops' : 'id.hydromart.app'}`,
);
