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
//   FRANCHISE_P95_MS  p95 threshold, ms           (2000)
//   PERFORMANCE_P95_MS p95 threshold, ms          (3000)
//
// Read-only: neither endpoint writes, so this is safe to point at a staging copy of prod.

import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const TOKEN = (__ENV.TOKEN || '').trim();
const VUS = Math.max(1, Number(__ENV.VUS || 5));
const DURATION = __ENV.DURATION || '30s';
const FRANCHISE_P95 = Number(__ENV.FRANCHISE_P95_MS || 2000);
const PERFORMANCE_P95 = Number(__ENV.PERFORMANCE_P95_MS || 3000);

const now = new Date();
const PERIOD =
  __ENV.PERIOD || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

const franchiseLatency = new Trend('franchise_dashboard_latency', true);
const performanceLatency = new Trend('performance_dashboard_latency', true);
const dashboardOk = new Rate('dashboard_success');

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
  // A franchise dashboard with no owned depots measures nothing: the whole point is cost
  // per depot. Say so loudly rather than reporting a fast, empty page.
  const owned = probe.status === 200 ? (probe.json('depots') || []).length : 0;
  if (owned === 0) console.warn('WARN: this owner has 0 depots — S-1 fan-out is not exercised.');
  else console.log(`owner has ${owned} depot(s) — S-1 cost should be flat across them`);
  return { owned };
}

export default function () {
  const headers = { authorization: `Bearer ${TOKEN}` };

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
  if (!fOk) console.error(`franchise ${franchise.status}: ${franchise.body}`);
  if (!pOk) console.error(`performance ${performance.status}: ${performance.body}`);
}
