#!/usr/bin/env node
/**
 * M14. Compile a shared package during `prepare` — but only when its source is here.
 *
 * `npm ci` runs `prepare` for every workspace, and `prepare` on @hydromart/access and
 * @hydromart/platform compiles them. That is what made the Dockerfiles copy
 * `packages/*` ABOVE `npm ci`: without the source, `prepare` failed and the install
 * exited non-zero in all nineteen images.
 *
 * And that ordering is what cost ~39 minutes on any deploy that touched `packages/`:
 * one line in platform invalidated the `COPY packages/*` layer, which invalidated
 * `npm ci` under it, nineteen times over.
 *
 * `npm ci --ignore-scripts` looks like the fix and is not — MEASURED 2026-08-25, npm
 * still ran `prepare` for the workspace packages and the build died on
 * `TS5058: The specified path does not exist: '../access/tsconfig.json'`. So the flag
 * cannot move the COPY; only teaching `prepare` about the case can.
 *
 * Hence: no source, nothing to compile, exit 0. The image copies the source afterwards
 * and runs `npm run build` explicitly, which is the same `tsc` invocation this would
 * have made. A developer's install is untouched — their source is present, so this
 * compiles exactly as `prepare` always did, and `dist/` still exists after `npm i`
 * (the CI test shards depend on that: nothing maps @hydromart/* to src).
 *
 * Node rather than a shell test so it behaves the same on a Windows dev machine.
 *
 *   node ../../scripts/build-shared-if-source.mjs access
 *   node ../../scripts/build-shared-if-source.mjs platform   (builds access first)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = process.argv[2];
if (pkg !== 'access' && pkg !== 'platform') {
  console.error(`build-shared-if-source: expected "access" or "platform", got ${pkg ?? '(nothing)'}`);
  process.exit(2);
}

// Resolve against THIS file, not the cwd: `prepare` runs with the cwd set to the package
// being prepared, and the same script is called from two of them.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcOf = (name) => join(repo, 'packages', name, 'src', 'index.ts');
const TSC = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');

// platform imports access, .dockerignore strips **/dist so nothing arrives prebuilt, and
// npm gives no ordering guarantee between two workspaces' prepare scripts. So platform
// builds access first — the note that used to live in its package.json.
const order = pkg === 'platform' ? ['access', 'platform'] : ['access'];

const missing = order.filter((name) => !existsSync(srcOf(name)));
if (missing.length > 0) {
  // The image case. Saying so out loud matters: a silent skip here would look identical
  // to a successful compile, and the next failure would surface as a missing `dist` in
  // something unrelated.
  console.log(
    `build-shared-if-source: no source for ${missing.join(', ')} — nothing to compile ` +
      '(expected inside a Docker build; the image compiles it after COPY)',
  );
  process.exit(0);
}

for (const name of order) {
  // The compiler is invoked through Node directly rather than through `npx`: no shell
  // (`shell: true` with arguments is a Node deprecation and a concatenation into sh for
  // no benefit), and no PATH lookup — `npx.cmd` does not spawn without a shell on
  // Windows, which is where this also has to work.
  execFileSync(process.execPath, [TSC, '-p', join(repo, 'packages', name, 'tsconfig.json')], {
    stdio: 'inherit',
  });
}
