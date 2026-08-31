#!/usr/bin/env node
/*
 * Check the two things about a Sentry DSN that CAN be checked — and say plainly which one
 * cannot, instead of implying it was.
 *
 * Every Sentry check this repo had asked `.env` whether a string was non-empty. That is a
 * different question, and the gap cost the whole feature: the web DSN was set, the SDK
 * loaded, `init()` succeeded, and every event was refused by the BROWSER, because the site's
 * own CSP allowed `*.ingest.sentry.io` while the DSN was an EU-region `*.ingest.DE.sentry.io`
 * — a CSP wildcard matches one label. Nothing was red anywhere for a day.
 *
 * WHAT THIS PROVES
 *   1. the DSN parses into host / key / project id;
 *   2. the host is actually reachable from here — DNS, TLS, egress;
 *   3. --csp: the DSN host is one the given Content-Security-Policy permits. That is the bug
 *      above, and it is the only one of the three that a browser enforces.
 *
 * WHAT IT CANNOT PROVE, measured rather than assumed:
 *   whether the KEY is valid. Sentry's SaaS ingest accepts optimistically and processes
 *   later — a wrong key, and even a wrong project id, both answer HTTP 200 on `/envelope/`
 *   AND on `/store/`. Confirming a key needs Sentry's Web API and an auth token, which is a
 *   different credential with a different blast radius. So this does not claim it, and a
 *   green here means "reachable and permitted", never "reports are arriving".
 *
 *   node scripts/check-sentry-reachable.mjs --dsn <dsn> [--csp "<connect-src value>"]
 *
 * Exit: 0 reachable and permitted · 1 unreachable, malformed, or blocked by the CSP · 2 no DSN.
 */
const argv = process.argv;
const flag = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
};

const dsn = flag('--dsn') ?? process.env.SENTRY_DSN;
const csp = flag('--csp');

if (!dsn) {
  console.error('No DSN to test (pass --dsn or set SENTRY_DSN). Nothing was checked.');
  process.exit(2);
}

let host;
let projectId;
try {
  const u = new URL(dsn);
  host = u.host;
  projectId = u.pathname.replace(/^\//, '');
  if (!host || !u.username || !projectId) throw new Error('missing host, key or project id');
} catch (err) {
  console.error(`!! not a usable DSN: ${(err && err.message) || err}`);
  console.error('   Expected https://<key>@<org>.ingest.<region>.sentry.io/<projectId>');
  process.exit(1);
}

let failed = false;

/*
 * The CSP half, and the reason this script exists. A `connect-src` entry is matched by the
 * browser one LABEL at a time: `*.ingest.sentry.io` permits `o123.ingest.sentry.io` and
 * refuses `o123.ingest.de.sentry.io`. Implemented the same way here rather than with a loose
 * `includes`, which would have called the broken pairing fine.
 */
if (csp) {
  const permitted = csp
    .split(/\s+/)
    .filter((s) => s.startsWith('http'))
    .some((entry) => {
      const h = entry.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!h.startsWith('*.')) return h === host;
      const suffix = h.slice(1); // ".ingest.sentry.io"
      if (!host.endsWith(suffix)) return false;
      // One label only: what is left must not itself contain a dot.
      return !host.slice(0, host.length - suffix.length).includes('.');
    });
  if (permitted) {
    console.log(`csp OK — ${host} is permitted by connect-src.`);
  } else {
    console.error(`!! ${host} is NOT permitted by connect-src, so the browser will refuse every`);
    console.error('   report before it leaves the page. A CSP wildcard matches ONE label:');
    console.error(`   ${csp}`);
    failed = true;
  }
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);
try {
  const res = await fetch(`https://${host}/api/${projectId}/envelope/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope' },
    body: `${JSON.stringify({ dsn })}\n`,
    signal: controller.signal,
  });
  // Any answer at all proves the leg this can prove. The STATUS is deliberately not read as
  // a verdict on the key — see the header.
  console.log(`reachable OK — ${host} answered HTTP ${res.status} for project ${projectId}.`);
} catch (err) {
  const why = err && err.name === 'AbortError' ? 'timed out after 10s' : (err && err.message) || String(err);
  console.error(`!! could not reach ${host}: ${why}`);
  console.error('   Egress blocked, DNS, or the host in the DSN is wrong. Reports go nowhere.');
  failed = true;
} finally {
  clearTimeout(timer);
}

process.exitCode = failed ? 1 : 0;
