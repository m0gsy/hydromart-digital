#!/usr/bin/env node
/*
 * The DSN the browser is given must be a host the browser is ALLOWED to reach.
 *
 * Measured on production 2026-08-31, and it had cost the entire point of client error
 * reporting: `NEXT_PUBLIC_SENTRY_DSN` pointed at `o…….ingest.DE.sentry.io` (an EU-region
 * project, which is what Sentry hands you today), while the CSP shipped by Caddy allowed
 * only `https://*.ingest.sentry.io`. A wildcard matches ONE label, so `.de.` does not match.
 *
 * Nothing failed. The SDK downloaded, `init()` succeeded, and the first envelope was blocked
 * by the browser — so the web stayed exactly as blind as it was before the DSN existed,
 * except every visitor now paid to fetch the SDK for nothing. No test, probe or deploy gate
 * compared the two values, because they live in different files owned by different concerns.
 *
 * Worse, the knob to fix it was unreachable: `Caddyfile` reads `{$SENTRY_INGEST_ORIGIN:...}`
 * and `docker-compose.prod.yml` never passed that variable to the container, so the default
 * was the only value it could ever have.
 *
 * This checks the SHAPE — that the wiring exists and the default cannot silently win. It
 * cannot check the live pairing, because the DSN is in `.env` on the box; `scripts/deploy.sh`
 * does that half.
 */
import { readFileSync } from 'node:fs';

const problems = [];
const read = (p) => readFileSync(p, 'utf8');

const caddy = read('infra/caddy/Caddyfile');
const compose = read('docker-compose.prod.yml');

const knob = caddy.match(/\{\$([A-Z0-9_]+):?[^}]*\}/g) ?? [];
const named = new Set(knob.map((m) => m.replace(/^\{\$/, '').replace(/[:}].*$/, '')));

/*
 * Every variable the Caddyfile reads must be handed to the caddy service. A knob nothing
 * turns is worse than no knob: it reads as configurable and behaves as hardcoded.
 */
const caddyEnv = compose.slice(compose.indexOf('  caddy:'));
for (const name of named) {
  if (!new RegExp(`^\\s+${name}: \\$\\{${name}`, 'm').test(caddyEnv)) {
    problems.push(
      `Caddyfile reads {$${name}} and docker-compose.prod.yml never passes it to the caddy ` +
        `service, so its default is the only value it can ever have.`,
    );
  }
}

// And the CSP must carry the ingest knob at all — a literal host list here would go stale the
// day somebody creates a project in another region, which is exactly what happened.
if (!/connect-src[^;"]*\{\$SENTRY_INGEST_ORIGIN/.test(caddy)) {
  problems.push(
    'connect-src no longer reads {$SENTRY_INGEST_ORIGIN}. A hardcoded ingest host blocks every ' +
      'DSN from a different Sentry region, silently, in the browser.',
  );
}

if (problems.length > 0) {
  console.error('Caddy configuration knobs that cannot be turned:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`Caddy knobs OK — ${named.size} variable(s) read by the Caddyfile are all passed to the container.`);
}
