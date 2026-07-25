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
  if (res.status !== 200) fail(`catalog fetch failed: ${res.status} ${res.body}`);
  const body = res.json();
  const rows = Array.isArray(body) ? body : body.rows || body.data || [];
  const ids = rows
    .filter((p) => p && (p.active === undefined || p.active) && p.id)
    .map((p) => p.id);
  if (ids.length < CART_LINES) {
    fail(`need >= ${CART_LINES} products, catalog has ${ids.length}. Run scripts/seed.mjs.`);
  }
  return { productIds: ids };
}

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
    check(r, { 'add to cart 2xx': (x) => x.status >= 200 && x.status < 300 });
  }

  const res = http.post(
    `${BASE}/orders/api/v1/orders/checkout`,
    JSON.stringify({ deliveryAddress: ADDRESS }),
    { headers },
  );
  checkoutLatency.add(res.timings.duration);
  const ok = check(res, { 'checkout 2xx': (x) => x.status >= 200 && x.status < 300 });
  checkoutOk.add(ok);
  if (!ok) console.error(`checkout ${res.status}: ${res.body}`);
}
