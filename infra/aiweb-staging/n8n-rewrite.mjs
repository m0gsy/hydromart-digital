// Staging's n8n: a copy of the image's n8n/ (/opt/hydromart) whose workflows and credentials name
// the fake hydromart instead of hydromart's public API, then the command it was given, run on
// that copy:
//
//   node n8n-rewrite.mjs node /opt/hydromart/bin/setup.mjs   # n8n-setup (compose entrypoint)
//   node n8n-rewrite.mjs node /opt/hydromart/bin/drift.mjs   # the probe, via `docker exec n8n`
//
// setup.mjs and drift.mjs both read their workflows and credentials list from N8N_SETUP_ROOT,
// which is all this sets. A port of hydromart-ai's scripts/n8n-e2e/rewrite.mjs (its CI does the
// same for its test run); the image itself is never changed.
//
// Fails closed: when anything of production's host name is left in the copy (a new workflow with
// another URL, say), it stops before the command runs, so staging never calls production.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROD_API = 'https://api.hydromart-digital.com';
export const MOCK_API = 'http://hydromart-mock:9911';
const PROD_HOST = 'api.hydromart-digital.com';
const MOCK_HOST = 'hydromart-mock';

/** Copies `from` to a new directory under `into` and rewrites it. Returns the new directory. */
export function rewrite(from, into = tmpdir()) {
  const out = mkdtempSync(join(into, 'hm-'));
  cpSync(from, out, { recursive: true });
  for (const file of readdirSync(join(out, 'workflows')).filter((f) => f.endsWith('.json'))) {
    const path = join(out, 'workflows', file);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(PROD_API, MOCK_API));
  }
  const manifest = JSON.parse(readFileSync(join(out, 'credentials.json'), 'utf8')).map((c) => ({
    ...c,
    allowedDomains: c.allowedDomains === PROD_HOST ? MOCK_HOST : c.allowedDomains,
  }));
  writeFileSync(join(out, 'credentials.json'), JSON.stringify(manifest, null, 2));
  for (const file of [...readdirSync(join(out, 'workflows')).map((f) => join('workflows', f)), 'credentials.json']) {
    if (/hydromart-digital\.com/.test(readFileSync(join(out, file), 'utf8'))) {
      throw new Error(`${file} still names hydromart-digital.com after the rewrite: staging must not call production`);
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    console.error('usage: node n8n-rewrite.mjs <command...>');
    process.exit(2);
  }
  let root;
  try {
    root = rewrite(process.env.N8N_SETUP_ROOT || '/opt/hydromart');
  } catch (error) {
    console.error(`n8n-rewrite: ${error.message}`);
    process.exit(1);
  }
  const run = spawnSync(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, N8N_SETUP_ROOT: root } });
  process.exit(run.status ?? 1);
}
