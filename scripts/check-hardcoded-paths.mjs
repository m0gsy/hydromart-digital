#!/usr/bin/env node
/**
 * No absolute machine paths in code that CI runs.
 *
 * `.uat/lib.mjs` carried `cwd: 'g:/VsCode/Hydromart'` — the path on the laptop it was
 * written on. On a Linux runner that directory does not exist, so every `spawnSync` there
 * returned ENOENT with an empty stdout and threw nothing at all.
 *
 * The damage was not the failed command. It was what the harness concluded from it:
 * `readOtp` answered null, the first case failed with "no OTP logged", `ctx.customerA` was
 * never created, and NINETEEN later cases reported "Missing bearer token" — which reads
 * exactly like an authorisation defect in the product. One hardcoded path, and the harness
 * spent a whole run blaming the system it was testing.
 *
 * It walked `.uat` and `scripts` only, and that is how it stayed green over
 * `apps/web/scripts/play-screenshots.mjs`, whose output directory defaulted to
 * `g:/VsCode/Hydromart/docs/play-assets` — one directory outside its reach, for as long as
 * that file has existed. A check with a hand-picked list of places to look proves nothing
 * about the places not on the list. So it walks the repo now, and the list is of places to
 * SKIP: build output, dependencies, and generated code, each of which is regenerated rather
 * than edited.
 *
 * Exit 0 = nothing hardcodes a machine path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['.'];
/*
 * Not source: regenerated from source, or downloaded. A path baked into any of these is a
 * property of the machine that produced them, not a defect in the repo — and `full.json`
 * and `solo.json` (Playwright's JSON reporter, committed by accident and referenced by
 * nothing) were exactly that until they were deleted alongside this change.
 */
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'lcov-report',
  '.next',
  'out',
  'generated',
  'test-results',
  'playwright-report',
  '.audit_tmp',
]);
/** A drive letter, a /home/<user>, a /Users/<name>: paths that exist on exactly one box. */
const ABSOLUTE = /(['"`])(?:[A-Za-z]:[\/]|\/home\/[a-z]|\/Users\/)[^'"`\n]{3,}\1/g;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue; // a broken symlink is not a finding
    }
    if (stat.isDirectory()) {
      // `_`-prefixed: an archived harness kept for reference, not run by anything.
      // `mobile-out*`: the pruned web exports Capacitor syncs into the APK.
      if (!SKIP.has(entry) && !entry.startsWith('_') && !entry.startsWith('mobile-out')) {
        walk(path);
      }
    } else if (/\.(mjs|js|ts|tsx|sh)$/.test(entry)) {
      files.push(path);
    }
  }
};
for (const root of ROOTS) {
  try {
    walk(root);
  } catch {
    /* a root that is not checked out here is not a finding */
  }
}

const findings = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    // A comment explaining this very rule is not a violation of it.
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const m of line.matchAll(ABSOLUTE)) {
      findings.push(`${file}:${i + 1}: ${m[0]}`);
    }
  });
}

if (findings.length > 0) {
  console.error('Machine-specific absolute paths, which exist on exactly one computer:');
  for (const f of findings) console.error(`  - ${f}`);
  console.error('\nDerive the path instead (fileURLToPath(import.meta.url)), or pass it in.');
  process.exit(1);
}
console.log(`Hardcoded path check OK — ${files.length} file(s), none pinned to one machine.`);
