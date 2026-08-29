// k6 load test for the two dashboards the audit measured as the worst fan-outs (Q-17).
//
// The register put numbers on both:
//   S-1  owner/franchise dashboard — 3 HTTP calls PER OWNED DEPOT, so twelve depots opened
//        the page with thirty-six upstream requests.
//   S-6  HR performance dashboard  — ~600 queries and 200 HTTP calls for a 200-person depot,
//        because every employee was scored with its own attendance/holiday/sales reads.
//
// Both are now batched (PR 7). This is what proves it on a real stack: p95 should stay
// roughly FLAT as the depot count / roster size grows. If it climbs linearly, the fan-out
// is back.
//
//   k6 run scripts/load/dashboards.k6.js
//
// Required:
//   TOKEN     bearer access token for a user who can read both dashboards. An owner or
//             SUPER_ADMIN covers it (franchise needs owner scope, performance needs hrView).
//             Mint it the smoke.sh way: login -> [DEV OTP] from the auth log -> otp/verify.
//
// Optional (defaults in parens):
//   BASE_URL          gateway base                (http://localhost:8080)
//   PERIOD            performance period, YYYY-MM (current month)
//   VUS               virtual users               (5)
//   DURATION          test duration               (30s)
//   FRANCHISE_P95_MS  p95 threshold, ms           (500)
//   PERFORMANCE_P95_MS p95 threshold, ms          (600)
//
// M22 — where those two numbers come from, because until now they came from nowhere.
//
// The plan defended these thresholds as "calibrated to this runner, not to be re-baselined
// casually". They were never calibrated to any runner: 2000 and 3000 were picked by hand
// when the file was written, and this workflow had no green run to calibrate against.
//
// It has one now. Run 32686490758, 2026-08-24 — the only green Load run in the workflow's
// history (eleven of the twelve before it were red on seeded stock and token minting, not
// on latency):
//
//   franchise_dashboard_latency    p95 = 125.95ms   against 2000  -> 16x headroom
//   performance_dashboard_latency  p95 = 148.57ms   against 3000  -> 20x headroom
//
// A threshold twenty times above the measurement is not a threshold. The batched
// dashboards could regress TEN-fold — the exact S-1/S-6 fan-out coming back, 126ms to
// 1.26s — and this job would still report success. That is the failure mode the plan calls
// a gate that cannot go red, written into the one workflow whose entire purpose is to
// notice a regression.
//
// So: rewritten, not deleted, and honestly. 500/600 is ~4x the single observation — tight
// enough that a real fan-out regression trips it, loose enough that one slow runner does
// not. It is PROVISIONAL on n=1. The Phase M rule is three runs before concluding, so
// after three green runs, set each threshold from the worst of the three and say so here.
// The checkout ceiling (1500 vs an observed 564ms, 2.7x) is left alone: that headroom is
// already in gate range.
//
// n=2 as of run 33263857699, 2026-08-29 — the first run measured against these thresholds,
// and both passed with room:
//
//   franchise_dashboard_latency    p95 =  54.28ms   against 500
//   performance_dashboard_latency  p95 =  76.95ms   against 600
//   checkout_latency               p95 = 586.77ms   against 1500
//
// Note the spread between the two runs: franchise 125.95 -> 54.28 and performance
// 148.57 -> 76.95, both roughly HALVED, on identical code and an identical stack. That is
// runner variance, and it is the argument for not re-tightening off the newest run: a
// threshold set from 54ms would be red every time the runner has a bad day. One more green
// run and the rule above applies — worst of three.
//
// It also has to be said plainly: FRANCHISE'S NUMBER IS NOT A MEASUREMENT YET. Both runs
// logged "this owner has 0 depots", so 125.95 and 54.28 are the cost of an empty page and
// the threshold guarding them cannot go red for the regression it names. See setup() for
// the cause and the fix. Do not re-baseline that threshold until N > 0.
//
// Read-only: neither endpoint writes, so this is safe to point at a staging copy of prod.
//
// Audit CI-12 — READ THIS BEFORE RUNNING. The gateway rate-limits by IP (default
// RATE_LIMIT_MAX=100 per 60s). A load generator is ONE IP, so at any useful VU count this
// script trips the platform's own limiter and then measures the limiter, not the dashboards.
// A 429 is therefore a SETUP error here, not a result: the run aborts and says so.
//
// Raise the limit on the target for the duration of the run:
//   RATE_LIMIT_MAX=100000 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d gateway
// and put it back afterwards. Never point this at production with the real limit in place.

import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const TOKEN = (__ENV.TOKEN || '').trim();
const VUS = Math.max(1, Number(__ENV.VUS || 5));
const DURATION = __ENV.DURATION || '30s';
// M22: ~4x the one green run's p95 (125.95ms / 148.57ms), not the 16-20x headroom these
// carried before. Provisional on n=1 — see the header.
const FRANCHISE_P95 = Number(__ENV.FRANCHISE_P95_MS || 500);
const PERFORMANCE_P95 = Number(__ENV.PERFORMANCE_P95_MS || 600);

const now = new Date();
const PERIOD =
  __ENV.PERIOD || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

const franchiseLatency = new Trend('franchise_dashboard_latency', true);
const performanceLatency = new Trend('performance_dashboard_latency', true);
const dashboardOk = new Rate('dashboard_success');

/*
 * The fan-out WIDTH, recorded next to the latency it produced.
 *
 * Both of these scenarios exist to prove a per-item cost stopped multiplying — S-1 is 3 HTTP
 * calls per owned depot, S-6 is a read per employee. A p95 with no width beside it cannot
 * show that: 126ms over twelve depots and 126ms over zero are the same number on the page and
 * opposite facts.
 *
 * This is not hypothetical. MEASURED in both green runs this workflow has ever produced
 * (32686490758 and 33263857699): "WARN: this owner has 0 depots — S-1 fan-out is not
 * exercised", and both runs reported the franchise threshold as PASSED anyway. The width is
 * emitted as a metric so `--record` can refuse to write a baseline row for a fan-out that was
 * never fanned out, instead of parking an empty page's latency in the table as a guarantee.
 *
 * A Trend rather than a Counter: the value is constant for the run, so `med` in the exported
 * summary IS the width. A Counter would report width x iterations and need dividing.
 */
const franchiseDepots = new Trend('franchise_depots');
const performanceRoster = new Trend('performance_roster');

export const options = {
  scenarios: {
    dashboards: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    franchise_dashboard_latency: [`p(95)<${FRANCHISE_P95}`],
    performance_dashboard_latency: [`p(95)<${PERFORMANCE_P95}`],
    dashboard_success: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  if (!TOKEN) fail('Set TOKEN. See header for how to mint one.');
  const probe = http.get(`${BASE}/dashboard/api/v1/dashboard/franchise`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (probe.status === 401 || probe.status === 403) {
    fail(`TOKEN cannot read the franchise dashboard (${probe.status}) — needs owner scope.`);
  }
  if (probe.status === 429) {
    fail(
      'The gateway rate-limited the very first request (429). Raise RATE_LIMIT_MAX on the ' +
        'target for the run — otherwise this measures the limiter, not the dashboards (audit CI-12).',
    );
  }
  // A franchise dashboard with no owned depots measures nothing: the whole point is cost
  // per depot. Say so loudly rather than reporting a fast, empty page.
  //
  // Why it currently reads 0, measured: the workflow mints TOKEN with
  // `mint-tokens.mjs --staff`, which signs `role: 'SUPER_ADMIN'`. This endpoint scopes to
  // depots the caller OWNS, and a super-admin owns none — while the seed does create two
  // WARALABA depots with real owners (BDG-01, SBY-01). Minting for one of those owners is
  // what turns this scenario back on.
  const owned = probe.status === 200 ? (probe.json('depots') || []).length : 0;
  if (owned === 0) console.warn('WARN: this owner has 0 depots — S-1 fan-out is not exercised.');
  else console.log(`owner has ${owned} depot(s) — S-1 cost should be flat across them`);

  // The roster the performance dashboard actually scores. The endpoint answers
  // ScoredEmployee[], so its length is the S-6 width. Same reason as above: 77ms over five
  // seeded staff says nothing about the 200-person depot the audit measured.
  const perf = http.get(`${BASE}/performance/api/v1/performance/dashboard?periodMonth=${PERIOD}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const roster = perf.status === 200 && Array.isArray(perf.json()) ? perf.json().length : 0;
  if (roster === 0) console.warn('WARN: 0 employees scored — S-6 fan-out is not exercised.');
  else console.log(`performance dashboard scores ${roster} employee(s)`);

  return { owned, roster };
}

export default function (data) {
  const headers = { authorization: `Bearer ${TOKEN}` };

  // Constant for the run, so `med` in the exported summary is the width itself.
  franchiseDepots.add(data.owned);
  performanceRoster.add(data.roster);

  const franchise = http.get(`${BASE}/dashboard/api/v1/dashboard/franchise`, { headers });
  franchiseLatency.add(franchise.timings.duration);
  const fOk = check(franchise, { 'franchise 2xx': (r) => r.status >= 200 && r.status < 300 });

  const performance = http.get(
    `${BASE}/performance/api/v1/performance/dashboard?periodMonth=${PERIOD}`,
    { headers },
  );
  performanceLatency.add(performance.timings.duration);
  const pOk = check(performance, { 'performance 2xx': (r) => r.status >= 200 && r.status < 300 });

  dashboardOk.add(fOk && pOk);
  // A 429 mid-run invalidates every number after it, so it is reported as the setup fault
  // it is rather than folded into the failure rate (audit CI-12).
  if (franchise.status === 429 || performance.status === 429) {
    fail('Rate-limited mid-run (429) — raise RATE_LIMIT_MAX on the target and re-run.');
  }
  if (!fOk) console.error(`franchise ${franchise.status}: ${franchise.body}`);
  if (!pOk) console.error(`performance ${performance.status}: ${performance.body}`);
}
