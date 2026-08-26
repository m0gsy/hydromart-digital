#!/usr/bin/env node
/**
 * BI-2 — /metrics must not be reachable from the internet.
 *
 * `enableMetrics` mounts GET /metrics outside the api prefix and outside every guard, on
 * purpose: Prometheus carries no token and scrapes over the docker network. The gateway does
 * the same, and the gateway is what the public API hostname proxies — so
 * `https://<API_DOMAIN>/metrics` served the whole platform's traffic to anybody who asked:
 * request counts by route and status (orders placed, payments confirmed, logins attempted,
 * what is failing right now), install counts per app build, heap and event-loop figures.
 *
 * Two things are checked, and both of them can fail:
 *
 *   1. the API site in the Caddyfile blocks /metrics before it proxies anything;
 *   2. no site proxies a bare `/metrics` path to a container.
 *
 * With `--url https://api.example` it also ASKS: a live 200 fails this check no matter what
 * the file says, because a config that is not deployed protects nothing.
 *
 *   node scripts/check-public-metrics.mjs
 *   node scripts/check-public-metrics.mjs --url https://api.hydromart.id
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const caddyfile = readFileSync(join(repo, 'Caddyfile'), 'utf8');

let failed = false;
const fail = (msg) => {
  console.error(`!! ${msg}`);
  failed = true;
};
const ok = (msg) => console.log(`ok   ${msg}`);

// The API site block: the line that OPENS it, to the closing brace at column 0. Matched at
// line start on purpose — `{$API_DOMAIN}` also appears inside the web site's connect-src,
// and matching that instead is how this check would have passed while measuring the wrong
// block entirely.
const opener = /^\{\$API_DOMAIN\}\s*\{$/m.exec(caddyfile);
const start = opener ? opener.index : -1;
if (start === -1) {
  fail('no {$API_DOMAIN} site in the Caddyfile — has the public entry point moved?');
} else {
  const end = caddyfile.indexOf('\n}', start);
  const site = caddyfile.slice(start, end === -1 ? undefined : end);

  const blocks = /handle\s+\/metrics\*?\s*\{[^}]*\brespond\s+(\d{3})/.exec(site);
  if (!blocks) {
    fail(
      'the public API site does not block /metrics.\n' +
        '   Prometheus scrapes the containers directly over the docker network, so nothing\n' +
        '   legitimate needs this path through the proxy. Add, before reverse_proxy:\n' +
        '     handle /metrics* {\n' +
        '       respond 404\n' +
        '     }',
    );
  } else if (!['404', '403'].includes(blocks[1])) {
    fail(`/metrics is answered with ${blocks[1]} — that is not a refusal`);
  } else {
    // Order matters in Caddy: a `handle` after `reverse_proxy` still wins for its own
    // matcher, but a bare `reverse_proxy` before it makes the intent unreadable. Assert
    // the block exists BEFORE the proxy so the file says what it does.
    if (site.indexOf('handle /metrics') > site.indexOf('reverse_proxy')) {
      fail('the /metrics block sits after reverse_proxy — put it before, so the file reads in order');
    } else {
      ok(`the public API site refuses /metrics (${blocks[1]})`);
    }
  }
}

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null;
if (url) {
  const target = `${url.replace(/\/+$/, '')}/metrics`;
  try {
    const res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (res.status === 200) {
      const body = await res.text();
      fail(
        `${target} answered 200 with ${body.length} bytes of metrics — the config is not deployed`,
      );
    } else {
      ok(`${target} answered ${res.status}`);
    }
  } catch (err) {
    // A network failure is not a pass and not a failure: it is an unanswered question, and
    // saying so beats a green tick for a host that was simply unreachable.
    console.log(`??   ${target} could not be reached (${err.message}) — not checked`);
  }
}

process.exit(failed ? 1 : 0);
