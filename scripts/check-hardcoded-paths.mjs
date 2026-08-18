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
 * Exit 0 = nothing hardcodes a machine path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['.uat', 'scripts'];
/** A drive letter, a /home/<user>, a /Users/<name>: paths that exist on exactly one box. */
const ABSOLUTE = /(['"`])(?:[A-Za-z]:[\/]|\/home\/[a-z]|\/Users\/)[^'"`\n]{3,}\1/g;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && !entry.startsWith('_')) walk(path);
    } else if (/\.(mjs|js|ts)$/.test(entry)) {
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
