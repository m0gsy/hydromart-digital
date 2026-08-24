// k6 load test for the checkout hot path (T6 / DB-7).
//
// DB-7 was the sequential per-product catalog fetch during checkout. It is now a
// parallel fan-out (order.service.ts `pricedAll`, Promise.all over unique lines).
// This test exercises checkout with a configurable number of cart lines so ops can
// confirm the fan-out holds under load — i.e. p95 stays flat as CART_LINES grows,
// rather than degrading linearly the way the old N-sequential path would.
//
//   k6 run scripts/load/checkout.k6.js
//
// Required:
//   TOKENS   comma-separated bearer access tokens, ONE PER SEEDED CUSTOMER.
//            (Or TOKEN for a single one.) Mint them the smoke.sh way:
//            register -> read [DEV OTP] from auth log -> otp/verify -> .accessToken.
//            Checkout consumes a customer's server-side cart, so concurrent VUs
//            sharing one token contend on ONE cart and skew the numbers. Supply at
//            least as many tokens as VUS for clean latency; the test warns otherwise.
//
// Optional (defaults in parens):
//   BASE_URL          gateway base           (http://localhost:8080)
//   CART_LINES        distinct products/order(3)   — the DB-7 fan-out width
//   VUS               virtual users          (10)
//   DURATION          test duration          (30s)
//   CHECKOUT_P95_MS   p95 threshold, ms      (1500)
//
// Reads the live catalog once in setup(); needs a seeded product list
// (scripts/seed.mjs) and the stack up.
//
// Audit CI-12 — READ THIS BEFORE RUNNING. The gateway rate-limits by IP (default
// RATE_LIMIT_MAX=100 per 60s), and a load generator is ONE IP. At 10 VUs this script sends
// four requests per iteration, so it trips the platform's own limiter within seconds and
// then measures the limiter. A 429 is a SETUP error here, not a result — the run aborts.
//
// Raise the limit on the target for the duration of the run:
//   RATE_LIMIT_MAX=100000 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d gateway
// and put it back afterwards. Never point this at production with the real limit in place.

import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const CART_LINES = Math.max(1, Number(__ENV.CART_LINES || 3));
const VUS = Math.max(1, Number(__ENV.VUS || 10));
const DURATION = __ENV.DURATION || '30s';
const P95 = Number(__ENV.CHECKOUT_P95_MS || 1500);

const TOKENS = (__ENV.TOKENS || __ENV.TOKEN || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

const checkoutLatency = new Trend('checkout_latency', true);
const checkoutOk = new Rate('checkout_success');

export const options = {
  scenarios: {
    checkout: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    checkout_latency: [`p(95)<${P95}`],
    checkout_success: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

// A delivery address near seeded Depot Cikini (JKT-01) so checkout actually routes
// to a depot and runs the full priced() fan-out — the DB-7 path under test.
const ADDRESS = {
  recipientName: 'Load Test',
  phone: '081200000000',
  addressLine: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  postalCode: '10330',
  latitude: -6.1944,
  longitude: 106.8412,
};

export function setup() {
  if (TOKENS.length === 0) fail('Set TOKENS (or TOKEN). See header for how to mint them.');
  if (TOKENS.length < VUS) {
    console.warn(
      `WARN: ${TOKENS.length} token(s) for ${VUS} VUs — VUs will share carts and contend. ` +
        `Supply >= VUS tokens for clean checkout latency.`,
    );
  }
  const res = http.get(`${BASE}/products/api/v1/products`);
  if (res.status === 429) {
    fail(
      'The gateway rate-limited the very first request (429). Raise RATE_LIMIT_MAX on the ' +
        'target for the run — otherwise this measures the limiter, not checkout (audit CI-12).',
    );
  }
  if (res.status !== 200) fail(`catalog fetch failed: ${res.status} ${res.body}`);
  const body = res.json();
  // `items` FIRST, because that is the envelope this API actually uses — every paginated
  // response in the repo is `{ items, total, page, limit, totalPages }`. This read `rows`
  // and `data` and never `items`, so it took a full catalogue and saw an empty one, then
  // blamed the seed in its own error message and sent the reader off to re-run a script
  // that had already worked. A wrong key is bad; a wrong key that accuses something else
  // is what turns ten minutes into an evening.
  const rows = Array.isArray(body) ? body : body.items || body.rows || body.data || [];
  const ids = rows
    .filter((p) => p && (p.active === undefined || p.active) && p.id)
    .map((p) => p.id);
  if (ids.length < CART_LINES) {
    // Name what was actually received. "Run the seed" is a guess, and it was the wrong one.
    fail(
      `need >= ${CART_LINES} products, catalog has ${ids.length}. ` +
        `Response keys: [${Object.keys(body || {}).join(', ')}] — if the list is there under a ` +
        `key this does not read, that is the bug, not the seed.`,
    );
  }
  return { productIds: ids };
}

/*
 * Module scope is PER VU in k6, and that is the point: declared inside the iteration
 * function this resets every iteration, so "one report" would have been nine thousand of
 * them. Out here it latches once per VU for the whole run.
 */
let reportedFailure = false;

export default function (data) {
  const token = TOKENS[(__VU - 1) % TOKENS.length];
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  // Rotate the CART_LINES window through the catalog so different iterations exercise
  // different products (and so > CART_LINES-product catalogs aren't under-covered).
  const n = data.productIds.length;
  const start = (__ITER * CART_LINES) % n;
  for (let i = 0; i < CART_LINES; i++) {
    const productId = data.productIds[(start + i) % n];
    const r = http.post(
      `${BASE}/orders/api/v1/cart/items`,
      JSON.stringify({ productId, quantity: 1 }),
      { headers },
    );
    // Latch on the FIRST FAILURE, not the first request — the first request is the one that
    // works. Exactly three lines per VU succeed (the opening iteration) and everything after
    // is refused, so a diagnostic keyed to `__ITER === 0` printed nothing at all and cost a
    // whole run. One report per VU, on whichever request first fails.
    if ((r.status < 200 || r.status >= 300) && !reportedFailure) {
      reportedFailure = true;
      console.error(
        `add to cart failed (VU ${__VU}, iter ${__ITER}): HTTP ${r.status} ${String(r.body).slice(0, 300)}`,
      );
    }
    check(r, { 'add to cart 2xx': (x) => x.status >= 200 && x.status < 300 });  }

  const res = http.post(
    `${BASE}/orders/api/v1/orders/checkout`,
    JSON.stringify({ deliveryAddress: ADDRESS }),
    { headers },
  );
  checkoutLatency.add(res.timings.duration);
  // A 429 mid-run invalidates every number after it, so it is reported as the setup fault
  // it is rather than folded into the failure rate (audit CI-12).
  if (res.status === 429) {
    fail('Rate-limited mid-run (429) — raise RATE_LIMIT_MAX on the target and re-run.');
  }
  /*
   * Out of stock is a SETUP fault, exactly like the 429 above, and it has to say so.
   *
   * Folded into the failure rate it produced the most misleading run this repo has
   * recorded: p95 530ms against a 1500ms threshold — the number this script exists to
   * measure, comfortably green — and a red job reporting `checkout_success 41%`. Nothing
   * in that summary named stock. Worse, a refused checkout leaves the server-side cart
   * standing, so the next iteration adds another unit to every line and the quantities
   * compound; from the first exhaustion onward the run measures nothing at all.
   *
   * Raise SEED_STOCK_QTY on the seed step rather than lowering VUS — the load is the point.
   */
  if (res.status === 422 && String(res.body).includes('ORDER_INSUFFICIENT_STOCK')) {
    fail(
      'Out of stock mid-run — the seeded shelf is smaller than this run consumes. Raise ' +
        'SEED_STOCK_QTY on the seed step and re-run; every number after this point is ' +
        'stock depletion, not latency.',
    );
  }
  const ok = check(res, { 'checkout 2xx': (x) => x.status >= 200 && x.status < 300 });
  checkoutOk.add(ok);
  if (!ok) console.error(`checkout ${res.status}: ${res.body}`);
}
