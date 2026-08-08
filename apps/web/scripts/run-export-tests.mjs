#!/usr/bin/env node
/**
 * Runs the exported-binary Playwright suite against ONE binary's export.
 *
 *   node scripts/run-export-tests.mjs customer
 *   node scripts/run-export-tests.mjs ops
 *
 * A wrapper only because the two env vars this needs cannot be written inline in an npm
 * script that has to run on Windows as well as CI, and `cross-env` is not a dependency
 * worth adding for two lines. Each surface gets its own port so the two can run back to
 * back without the second one finding the first one's server still holding 4180.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const SURFACES = { customer: 4181, ops: 4182 };

const surface = process.argv[2];
if (!SURFACES[surface]) {
  console.error(`Usage: run-export-tests.mjs <${Object.keys(SURFACES).join('|')}>`);
  process.exit(1);
}

const WEB = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
);

execFileSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve('@playwright/test/cli'),
    'test',
    '-c',
    'playwright.static.config.ts',
  ],
  {
    cwd: WEB,
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPORT_DIR: `mobile-out-${surface}`,
      EXPORT_SURFACE: surface,
      EXPORT_PORT: String(SURFACES[surface]),
    },
  },
);
