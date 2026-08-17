#!/usr/bin/env node
/**
 * G5. A Play reviewer signs in with REVIEWER_PHONE, and on production that phone is Aziz —
 * a real employee, at a real depot, whose screens are full of real customers' names,
 * addresses and orders. The reviewer is a stranger with a fixed OTP; handing them a
 * colleague's account is a data disclosure with a support ticket attached, and it is also
 * a review that can fail for reasons nobody controls (a depot with no stock today shows a
 * reviewer an empty app).
 *
 * This builds the account they should get instead: one demo depot, one KEPALA_DEPOT who
 * runs it, and stock on its shelves — so the depot screens have something in them and
 * nothing in them belongs to a person. The customer side is deliberately NOT seeded here:
 * a customer account is made by registering one from the app, which is the flow the
 * reviewer is going to walk anyway.
 *
 *   GATEWAY_URL=https://api.hydromart.id \
 *   JWT_ACCESS_SECRET=<prod secret> \
 *   DEMO_PHONE=+62811DEMO0001 \
 *   node scripts/seed-demo-depot.mjs
 *
 * Idempotent: every step looks first and creates only what is missing, so a re-run after a
 * failure resumes rather than duplicates. Nothing here is destructive — it never edits or
 * deletes a row it did not create.
 *
 * Afterwards, point REVIEWER_PHONE at DEMO_PHONE (auth-service reads a comma-separated
 * list, so Aziz can be removed in the same edit) and recreate auth.
 */
import crypto from 'node:crypto';

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const DEMO_PHONE = process.env.DEMO_PHONE ?? '+6281199900001';
const DEMO_CUSTOMER_PHONE = process.env.DEMO_CUSTOMER_PHONE ?? '+6281199900002';
const DEPOT_CODE = process.env.DEMO_DEPOT_CODE ?? 'DEMO-01';

if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: crypto.randomUUID(),
    role: 'SUPER_ADMIN',
    phone: '+620000000000',
    iat: now,
    exp: now + 900,
  })}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}
const TOKEN = adminToken();

async function api(method, path, body) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

function ok(res, what) {
  if (res.status >= 400) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const rows = (body) => (Array.isArray(body) ? body : (body.items ?? body.data ?? []));

/*
 * Coordinates off the south coast of Java (Pulau Sempu, Malang): inside Indonesia, so the
 * map and the province validation are happy, and uninhabited with a 3 km radius — so no
 * real customer's address can route an order here. Checkout is fail-closed on distance;
 * that is what keeps this depot out of everybody else's app rather than a flag.
 */
const DEPOT = {
  code: DEPOT_CODE,
  name: 'Depot Demo (Play Review)',
  address: 'Kawasan demo — akun peninjau Google Play',
  city: 'Malang',
  province: 'Jawa Timur',
  contactPhone: '+6281199900000',
  lat: -8.4383,
  lng: 112.6861,
  serviceRadiusKm: 3,
  deliveryFee: 5000,
  minOrderAmount: 0,
  ownershipType: 'HKP',
};

/*
 * The four employment fields are REQUIRED on a staff invite for every role — the console
 * always sends them, so nothing in the repo ever exercised an invite without them. Leaving
 * them out is a 400, which is how the second real run of this died.
 */
const EMPLOYMENT = {
  position: 'Kepala Depot',
  joinDate: '2026-01-01',
  employmentStatus: 'PERMANENT',
  salaryType: 'MONTHLY',
  monthlyRate: 5_000_000,
};

/*
 * Three runs of this against production died on three different shape mismatches — `limit`
 * above the cap, a `phone` the depot DTO does not accept, and an invite missing the four
 * employment fields the console always happens to send. None of them were reachable from
 * anything the repo already ran: the contract gate proves a path exists and that a query
 * parameter is READ, never that a value is in range or that a body matches a DTO.
 *
 * So this script now also runs against the integration stack in CI (see ci.yml), where a
 * mismatch costs a red check instead of a production round trip.
 */

// The list endpoint caps `limit` at 100 and answers 400 above it — which is what the first
// real run of this hit, on its very first read. The endpoint-contract gate could not catch
// it: it checks that a path exists and that a query parameter is READ by the server, never
// that a VALUE is inside the range the server accepts.
async function findDepot() {
  const list = rows(ok(await api('GET', '/depots/api/v1/depots/manage?limit=100'), 'list depots'));
  return list.find((d) => d.code === DEPOT.code) ?? null;
}

async function main() {
  let depot = await findDepot();
  if (depot) {
    console.log(`= depot ${DEPOT.code} already exists (${depot.id})`);
  } else {
    depot = ok(await api('POST', '/depots/api/v1/depots', DEPOT), 'create demo depot');
    console.log(`+ depot ${DEPOT.code} (${depot.id})`);
  }

  // The head of the depot: the account the reviewer signs in as.
  const invite = await api('POST', '/auth/api/v1/auth/staff/invite', {
    phone: DEMO_PHONE,
    role: 'KEPALA_DEPOT',
    fullName: 'Kepala Depot Demo',
    depotId: depot.id,
    ...EMPLOYMENT,
  });
  // 409 = already invited, which is the whole point of running this twice.
  if (invite.status === 409) console.log(`= staff ${DEMO_PHONE} already invited`);
  else console.log(`+ staff KEPALA_DEPOT ${DEMO_PHONE}`, ok(invite, 'invite demo kepala depot').id ?? '');

  // Stock, so the depot's screens are not a row of zeroes. Everything already in the
  // catalogue, 100 each — a demo depot sells nothing, so the number never moves.
  const products = rows(ok(await api('GET', '/products/api/v1/products?limit=100'), 'list products'));
  const existing = rows(
    ok(await api('GET', `/depots/api/v1/depots/${depot.id}/inventory`), 'list demo inventory'),
  ).map((i) => i.productId);
  for (const product of products.slice(0, 6)) {
    if (existing.includes(product.id)) continue;
    ok(
      await api('POST', `/depots/api/v1/depots/${depot.id}/inventory`, {
        itemType: 'PRODUK',
        productId: product.id,
        label: product.name,
        unit: product.unit,
        quantity: 100,
        minimumStock: 10,
      }),
      `stock ${product.sku}`,
    );
    console.log(`+ stock ${product.sku} x100`);
  }

  console.log('\nDemo depot ready.');
  console.log(`  depot     ${depot.id} (${DEPOT.code})`);
  console.log(`  login     ${DEMO_PHONE}  (KEPALA_DEPOT)`);
  console.log(`  customer  ${DEMO_CUSTOMER_PHONE}  — register it from the app to fill the customer screens`);
  console.log('\nNow point REVIEWER_PHONE at the demo number and recreate auth:');
  console.log(`  REVIEWER_PHONE=${DEMO_PHONE}`);
  console.log('  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate auth');
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exitCode = 1;
});
