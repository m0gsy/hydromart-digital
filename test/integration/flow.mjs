// Integration assertions driven through the gateway over real HTTP. Run against
// an already-up stack (`node test/integration/flow.mjs`) or via the orchestrator
// (`npm run test:integration`). Covers four scenarios end to end:
//   1. core loop      — register -> checkout -> cash pay/confirm -> complete -> loyalty
//   2. depot-routed    — per-depot delivery fee + stock reserve at checkout + deduct on complete
//   3. online webhook  — EWALLET charge (stubbed gateway) -> signed PAID webhook -> order CONFIRMED
//   4. failure paths   — below-minimum / out-of-service-area / insufficient-stock all rejected 422
//   5. QRIS            — the depot's headline rail: PENDING until staff confirm, no gateway
//   6. delivery leg    — shift check-in (geofence) -> assign -> pickup -> start -> COD cash
//                        confirm -> PoD -> order COMPLETED -> settlement submit/verify ->
//                        courier earning credited
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
// Must equal x-shared JWT_ACCESS_SECRET in docker-compose.test.yml.
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? 'itest-shared-access-secret-0123456789abcdef';
// Must equal PAYMENT_WEBHOOK_SECRET in docker-compose.test.yml.
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'itest-webhook-secret-min-16-chars';
const COMPOSE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml'];
const win = process.platform === 'win32';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Auth mints { sub, role, phone } HS256; the platform guard reads user.role (singular).
function staffToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: 'HS256', typ: 'JWT' };
  const body = { sub: crypto.randomUUID(), role: 'SUPER_ADMIN', phone: '+620000000000', iat: now, exp: now + 900 };
  const data = `${b64(head)}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// Provider webhook signature: HMAC-SHA256 hex over `${reference}.${event}`.
// Q-15: the HMAC covers every field except the signature, sorted, plus a timestamp the
// service checks for freshness. Mirrors webhookSigningPayload() in payment-service's
// domain — if that canonical form changes, this must change with it or the flow goes red.
function signWebhook(payload) {
  const canonical = Object.keys(payload)
    .filter((key) => key !== 'signature' && payload[key] !== undefined)
    .sort()
    .map((key) => `${key}=${String(payload[key] ?? '')}`)
    .join('&');
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(canonical).digest('hex');
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  // SEC-4: the gateway moves login tokens into Set-Cookie, so expose them for the
  // callers that need the raw access JWT (registerCustomer reads hm_at).
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, body: json, cookies };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

/** Pull a cookie value out of a response's Set-Cookie list (name=value; ...). */
function cookieValue(cookies, name) {
  const hit = cookies.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).split(';')[0] : undefined;
}
function ok(res, step) { assert(res.status >= 200 && res.status < 300, `${step}: HTTP ${res.status} — ${JSON.stringify(res.body)}`); }

// The console OTP adapter logs (pino JSON): "[DEV OTP] REGISTRATION code for <phone>: NNNNNN (valid ...)"
async function readOtp(phone) {
  const re = new RegExp(`REGISTRATION code for \\${phone}:\\s*(\\d{4,8})`);
  for (let i = 0; i < 15; i++) {
    const r = spawnSync('docker', ['compose', ...COMPOSE, 'logs', '--no-log-prefix', 'auth'], { encoding: 'utf8', shell: win });
    const logs = (r.stdout || '') + (r.stderr || '');
    const m = [...logs.matchAll(new RegExp(re, 'g'))];
    if (m.length) return m[m.length - 1][1];
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`OTP for ${phone} not found in auth logs`);
}

// A unique phone per registration (BR-001 one phone = one account). The DB volume
// persists across runs, so the timestamp+sequence keeps repeat runs collision-free.
let phoneSeq = 0;
const nextPhone = () => `+62811${String(Date.now()).slice(-6)}${String(phoneSeq++ % 100).padStart(2, '0')}`;

// A remote depot coordinate jittered ~±100m per run: the DB volume persists, so
// jitter guarantees THIS run's depot is the nearest one to its own checkout address
// (exact-match distance 0) even when prior runs left depots at the same base point.
function remote(lat, lng) {
  const jitter = () => (Math.random() - 0.5) * 0.002;
  return { lat: +(lat + jitter()).toFixed(6), lng: +(lng + jitter()).toFixed(6) };
}

async function createProduct(staff, basePrice = 20000) {
  const sku = `ITEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const res = await api('POST', '/products/api/v1/products', {
    token: staff,
    // isGallon must be explicit: the per-galon delivery fee is charged off this flag,
    // not off the unit label, so a galon seeded without it prices at zero delivery
    // (which is exactly what the fee assertion below catches).
    body: { name: 'Integration Galon 19L', sku, unit: 'galon', volumeMl: 19000, isGallon: true, basePrice },
  });
  ok(res, 'create product');
  assert(res.body.id, `no product id: ${JSON.stringify(res.body)}`);
  return { productId: res.body.id, sku, basePrice };
}

// Every depot this run creates, so the run can retire them again. A left-behind active
// ITEST depot keeps competing for order routing on the shared database — that is how six
// "Integration Depot" rows ended up sitting in Bali/Manado/Medan and quietly turned real
// UAT cases (out-of-service-area, nearest-depot) into false failures.
const createdDepots = [];

async function retireCreatedDepots(staff) {
  for (const id of createdDepots.splice(0)) {
    try {
      await api('PATCH', `/depots/api/v1/depots/${id}`, { token: staff, body: { active: false } });
    } catch (e) {
      console.error(`cleanup: could not deactivate depot ${id}: ${e.message}`);
    }
  }
}

async function createDepot(staff, { lat, lng, deliveryFee, minOrderAmount, serviceRadiusKm }) {
  const res = await api('POST', '/depots/api/v1/depots', {
    token: staff,
    body: {
      code: `ITEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      name: 'Integration Depot',
      ownershipType: 'HKP',
      address: 'Jl. Integration No. 1', city: 'Test City', province: 'Test',
      lat, lng, serviceRadiusKm, deliveryFee, minOrderAmount,
    },
  });
  ok(res, 'create depot');
  assert(res.body.id, `no depot id: ${JSON.stringify(res.body)}`);
  createdDepots.push(res.body.id);
  return res.body;
}

async function createStock(staff, depotId, productId, quantity) {
  const res = await api('POST', `/depots/api/v1/depots/${depotId}/inventory`, {
    token: staff,
    body: { itemType: 'PRODUK', productId, label: 'Integration Stock', unit: 'galon', quantity, minimumStock: 0 },
  });
  ok(res, 'create stock line');
  assert(res.body.id, `no stock line id: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function getInventory(staff, itemId) {
  const res = await api('GET', `/depots/api/v1/inventory/${itemId}`, { token: staff });
  ok(res, 'get inventory line');
  return res.body;
}

async function getOrder(staff, id) {
  const res = await api('GET', `/orders/api/v1/orders/manage/${id}`, { token: staff });
  ok(res, 'get order');
  return res.body;
}

async function registerCustomer() {
  const phone = nextPhone();
  ok(await api('POST', '/auth/api/v1/auth/register', { body: { phone, fullName: 'Integration User' } }), 'register');
  const code = await readOtp(phone);
  const verify = await api('POST', '/auth/api/v1/auth/otp/verify', { body: { phone, code, purpose: 'REGISTRATION' } });
  ok(verify, 'verify otp');
  // SEC-4: the access JWT now rides in the httpOnly hm_at cookie, not the JSON body.
  // Extract it and use it as the bearer for downstream calls (services still accept it).
  const token = cookieValue(verify.cookies, 'hm_at');
  assert(token, `no hm_at cookie: ${JSON.stringify(verify.body)}`);
  return { phone, token };
}

// Walk an order from wherever it is to COMPLETED (BR-012 forward sequence). Read the
// current status first: the payment->order auto-confirm is fail-open, so the order
// may still be CREATED or already CONFIRMED — advance from whatever it is.
async function advanceToCompleted(staff, orderId) {
  const SEQ = ['CREATED', 'CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED'];
  const cur = (await getOrder(staff, orderId)).status;
  for (let i = SEQ.indexOf(cur) + 1; i < SEQ.length; i++) {
    ok(await api('PATCH', `/orders/api/v1/orders/${orderId}/status`, { token: staff, body: { status: SEQ[i] } }), `advance ${SEQ[i]}`);
  }
}

// 1. Core transaction loop: order COMPLETED + loyalty awarded across a real service boundary.
//    Address carries no map pin, so this also covers the CUSTOMER-PICKED depot path:
//    checkout is fail-CLOSED now, and an unpinned address is only placeable with an
//    explicit `depotId` (order.service.ts resolveDepot).
async function coreLoop(staff) {
  const { productId } = await createProduct(staff);
  const depot = await createDepot(staff, { ...remote(-6.2, 106.82), deliveryFee: 6000, minOrderAmount: 0, serviceRadiusKm: 5 });
  await createStock(staff, depot.id, productId, 100);
  const { phone, token } = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 2 } }), 'add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: {
      depotId: depot.id,
      deliveryAddress: { recipientName: 'Integration User', phone, addressLine: 'Jl. Test 1', city: 'Jakarta', province: 'DKI Jakarta' },
    },
  });
  ok(checkout, 'checkout');
  assert(checkout.body.depotId === depot.id, `checkout: picked depot ignored — got ${checkout.body.depotId}`);
  const orderId = checkout.body.id;
  const total = checkout.body.total;
  assert(orderId && total > 0, `bad checkout: ${JSON.stringify(checkout.body)}`);

  const pay = await api('POST', '/payments/api/v1/payments', { token, body: { orderId, method: 'CASH', amount: total } });
  ok(pay, 'initiate payment');
  ok(await api('POST', `/payments/api/v1/payments/${pay.body.id}/confirm`, { token: staff }), 'confirm payment');
  await advanceToCompleted(staff, orderId);

  const finalOrder = await getOrder(staff, orderId);
  assert(finalOrder.status === 'COMPLETED', `order status ${finalOrder.status} != COMPLETED`);
  const loyalty = await api('GET', '/loyalty/api/v1/loyalty/me', { token });
  ok(loyalty, 'loyalty me');
  assert(loyalty.body.pointsBalance > 0, `expected points > 0, got ${JSON.stringify(loyalty.body)}`);
  console.log(`PASSED core-loop: order ${orderId} COMPLETED, ${loyalty.body.pointsBalance} loyalty points, total ${total}`);
}

// 2. Depot routing: checkout routes to the covering depot, applies its per-depot
//    delivery fee, reserves stock; completion deducts physical stock.
async function depotRoutedLoop(staff) {
  const { productId, basePrice } = await createProduct(staff);
  const geo = remote(-8.65, 115.22); // Bali, jittered
  const depot = await createDepot(staff, { ...geo, deliveryFee: 7000, minOrderAmount: 10000, serviceRadiusKm: 5 });
  const item = await createStock(staff, depot.id, productId, 100);
  const { phone, token } = await registerCustomer();

  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 2 } }), 'dr: add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: { deliveryAddress: { recipientName: 'DR User', phone, addressLine: 'Jl. Bali 1', city: 'Denpasar', province: 'Bali', latitude: geo.lat, longitude: geo.lng } },
  });
  ok(checkout, 'dr: checkout');
  const order = checkout.body;
  assert(order.depotId === depot.id, `dr: routed to ${order.depotId}, expected ${depot.id}`);
  // Delivery fee is per-galon (perUnitFee 7000 x 2 galons ordered), not flat.
  assert(order.deliveryFee === 7000 * 2, `dr: per-depot fee ${order.deliveryFee} != ${7000 * 2} (7000/galon x 2)`);
  const subtotal = basePrice * 2;
  assert(order.subtotal === subtotal, `dr: subtotal ${order.subtotal} != ${subtotal}`);
  assert(order.total === subtotal + order.deliveryFee - order.discount, `dr: total ${order.total} mismatch`);

  // Stock reserved at checkout: sellable (available) drops, physical quantity untouched.
  const reserved = await getInventory(staff, item.id);
  assert(reserved.quantity === 100 && reserved.available === 98, `dr: after reserve ${reserved.available}/${reserved.quantity} != 98/100`);

  const pay = await api('POST', '/payments/api/v1/payments', { token, body: { orderId: order.id, method: 'CASH', amount: order.total } });
  ok(pay, 'dr: initiate payment');
  ok(await api('POST', `/payments/api/v1/payments/${pay.body.id}/confirm`, { token: staff }), 'dr: confirm payment');
  await advanceToCompleted(staff, order.id);

  const consumed = await getInventory(staff, item.id);
  assert(consumed.quantity === 98, `dr: after complete physical ${consumed.quantity} != 98`);
  console.log(`PASSED depot-routed: order ${order.id} -> depot ${depot.id}, fee ${order.deliveryFee}, stock 100->98`);
}

// 3. Online payment: an EWALLET charge succeeds via the gateway stub (PENDING+reference);
//    a bad-signature webhook is rejected; a signed PAID webhook confirms the order.
//    (QRIS is now offline/direct-to-depot — staff-confirmed, no gateway — so the online
//    webhook path uses a genuinely-online method: EWALLET or VA.)
async function onlineWebhookLoop(staff) {
  const { productId } = await createProduct(staff);
  const depot = await createDepot(staff, { ...remote(-6.9, 107.6), deliveryFee: 6000, minOrderAmount: 0, serviceRadiusKm: 5 });
  await createStock(staff, depot.id, productId, 100);
  const { phone, token } = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 1 } }), 'ow: add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: {
      depotId: depot.id,
      deliveryAddress: { recipientName: 'OW User', phone, addressLine: 'Jl. OW 1', city: 'Jakarta', province: 'DKI Jakarta' },
    },
  });
  ok(checkout, 'ow: checkout');
  const orderId = checkout.body.id;

  const pay = await api('POST', '/payments/api/v1/payments', { token, body: { orderId, method: 'EWALLET', amount: checkout.body.total } });
  ok(pay, 'ow: initiate online payment');
  const reference = pay.body.reference;
  assert(pay.body.status === 'PENDING' && reference, `ow: expected PENDING+reference, got ${JSON.stringify(pay.body)}`);

  // Bad signature is rejected (InvalidWebhookSignatureError -> 401). The payload must
  // otherwise be VALID — a missing timestamp is a 400 from validation, which would pass
  // an assertion about rejection while proving nothing about the signature check.
  const badPayload = { reference, event: 'PAID', timestamp: Date.now(), signature: 'deadbeef'.repeat(8) };
  const bad = await api('POST', '/payments/api/v1/payments/webhook', { body: badPayload });
  assert(bad.status === 401, `ow: bad-signature webhook expected 401, got ${bad.status}`);

  // Signed PAID webhook settles the payment and confirms the order (payment -> order internal-confirm).
  const goodPayload = { reference, event: 'PAID', timestamp: Date.now() };
  const good = await api('POST', '/payments/api/v1/payments/webhook', {
    body: { ...goodPayload, signature: signWebhook(goodPayload) },
  });
  ok(good, 'ow: signed webhook');
  assert(good.body.handled === true, `ow: webhook not handled: ${JSON.stringify(good.body)}`);

  const order = await getOrder(staff, orderId);
  assert(order.status === 'CONFIRMED', `ow: order status ${order.status} != CONFIRMED after PAID webhook`);
  console.log(`PASSED online-webhook: order ${orderId} PAID via ${reference} -> CONFIRMED`);
}

// 4. Failure paths: each must be rejected at checkout with 422.
async function failurePaths(staff) {
  const { productId } = await createProduct(staff); // basePrice 20000

  // Below the depot's minimum order (subtotal 20000 < min 100000).
  const geoMin = remote(1.49, 124.84); // Manado
  await createDepot(staff, { ...geoMin, deliveryFee: 6000, minOrderAmount: 100000, serviceRadiusKm: 5 });
  const c1 = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token: c1.token, body: { productId, quantity: 1 } }), 'fp: cart below-min');
  const belowMin = await api('POST', '/orders/api/v1/orders/checkout', {
    token: c1.token,
    body: { deliveryAddress: { recipientName: 'FP', phone: c1.phone, addressLine: 'Jl. Manado', city: 'Manado', province: 'Sulut', latitude: geoMin.lat, longitude: geoMin.lng } },
  });
  assert(belowMin.status === 422, `fp: below-min expected 422, got ${belowMin.status} — ${JSON.stringify(belowMin.body)}`);

  // Out of service area: coordinates far from every (Indonesia-clustered) depot.
  const c2 = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token: c2.token, body: { productId, quantity: 1 } }), 'fp: cart out-of-area');
  const outArea = await api('POST', '/orders/api/v1/orders/checkout', {
    token: c2.token,
    body: { deliveryAddress: { recipientName: 'FP', phone: c2.phone, addressLine: 'Nowhere', city: 'Ocean', province: 'Pacific', latitude: -40, longitude: -100 } },
  });
  assert(outArea.status === 422, `fp: out-of-area expected 422, got ${outArea.status} — ${JSON.stringify(outArea.body)}`);

  // Insufficient stock: order 5 units against a depot line holding 1.
  const geoStock = remote(3.59, 98.67); // Medan
  const stockDepot = await createDepot(staff, { ...geoStock, deliveryFee: 6000, minOrderAmount: 0, serviceRadiusKm: 5 });
  await createStock(staff, stockDepot.id, productId, 1);
  const c3 = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token: c3.token, body: { productId, quantity: 5 } }), 'fp: cart insufficient');
  const shortage = await api('POST', '/orders/api/v1/orders/checkout', {
    token: c3.token,
    body: { deliveryAddress: { recipientName: 'FP', phone: c3.phone, addressLine: 'Jl. Medan', city: 'Medan', province: 'Sumut', latitude: geoStock.lat, longitude: geoStock.lng } },
  });
  assert(shortage.status === 422, `fp: insufficient-stock expected 422, got ${shortage.status} — ${JSON.stringify(shortage.body)}`);

  // No map pin AND no picked depot: nothing can route it, so it must be refused rather
  // than stored with depotId = null (an order no depot queue would ever show).
  const c4 = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token: c4.token, body: { productId, quantity: 1 } }), 'fp: cart unrouted');
  const unrouted = await api('POST', '/orders/api/v1/orders/checkout', {
    token: c4.token,
    body: { deliveryAddress: { recipientName: 'FP', phone: c4.phone, addressLine: 'Jl. Tanpa Pin', city: 'Jakarta', province: 'DKI Jakarta' } },
  });
  assert(unrouted.status === 422, `fp: unrouted expected 422, got ${unrouted.status} — ${JSON.stringify(unrouted.body)}`);
  assert(
    unrouted.body.code === 'ORDER_DEPOT_REQUIRED',
    `fp: unrouted expected ORDER_DEPOT_REQUIRED, got ${JSON.stringify(unrouted.body)}`,
  );

  console.log('PASSED failure-paths: below-min 422, out-of-area 422, insufficient-stock 422, unrouted 422');
}


/**
 * Poll until `done` is happy, or give up with a message that names the step.
 *
 * Completion effects cross a service boundary fire-and-forget, so asserting the instant
 * after a call is asserting into a race — and a race that usually passes is worse than one
 * that never does.
 */
async function eventually(read, done, message, tries = 20) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${message} — last saw ${JSON.stringify(last)}`);
}

/** A token for an account that really exists — see inviteDriver for why that matters. */
function roleToken(sub, role, phone) {
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: 'HS256', typ: 'JWT' };
  const body = { sub, role, phone, iat: now, exp: now + 900 };
  const data = `${b64(head)}.${b64(body)}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}

/*
 * A courier is not a token you can mint. A depot-resolved role resolves its depot set BY
 * `sub`, so a JWT with a random subject belongs to an account that does not exist, resolves
 * to no depots, and the scope guard refuses it — for a reason that has nothing to do with
 * what is being tested. So the driver is invited for real, and the token is minted over the
 * id that invite hands back.
 */
async function inviteDriver(staff, depotId) {
  const phone = nextPhone();
  const res = await api('POST', '/auth/api/v1/auth/staff/invite', {
    token: staff,
    /*
     * The console invite creates the ACCOUNT and the HR employee record together, so the
     * HR half's required fields come with it — position, join date, employment status and
     * salary type are not optional on this route. A courier fixture has to look like a
     * real hire, because the endpoint makes one.
     */
    body: {
      phone,
      role: 'STAFF_DEPOT',
      fullName: 'Integration Kurir',
      depotId,
      position: 'Kurir',
      joinDate: new Date().toISOString().slice(0, 10),
      employmentStatus: 'PERMANENT',
      salaryType: 'MONTHLY',
    },
  });
  ok(res, 'invite driver');
  assert(res.body.id, `no driver id: ${JSON.stringify(res.body)}`);
  return { id: res.body.id, phone, token: roleToken(res.body.id, 'STAFF_DEPOT', phone) };
}



/*
 * 5. Static QRIS — the payment rail this business actually runs on, and the one no test
 *    anywhere had ever selected.
 *
 * The decision is that QRIS is NOT an online method: every depot has its own static QR,
 * the money lands in the depot's account, and staff confirm it by hand — exactly like a
 * bank transfer. `ONLINE_METHODS` therefore holds only EWALLET and VA. That makes two
 * things worth pinning down, because a well-meaning change to either would be invisible:
 * QRIS must NOT reach for the payment gateway (which is unconfigured, so it would fail
 * closed and take the checkout down with it), and it must NOT self-confirm.
 */
async function qrisLoop(staff) {
  const { productId } = await createProduct(staff);
  const geo = remote(-0.02, 109.34); // Pontianak, jittered
  const depot = await createDepot(staff, { ...geo, deliveryFee: 4000, minOrderAmount: 0, serviceRadiusKm: 5 });
  await createStock(staff, depot.id, productId, 100);
  const { phone, token } = await registerCustomer();

  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 1 } }), 'qr: add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: {
      deliveryAddress: {
        recipientName: 'QR User', phone, addressLine: 'Jl. QRIS 1',
        city: 'Pontianak', province: 'Kalbar', latitude: geo.lat, longitude: geo.lng,
      },
    },
  });
  ok(checkout, 'qr: checkout');
  const order = checkout.body;

  const pay = await api('POST', '/payments/api/v1/payments', {
    token,
    body: { orderId: order.id, method: 'QRIS', amount: order.total },
  });
  ok(pay, 'qr: initiate QRIS payment');
  /*
   * PENDING, and no provider reference. A reference here would mean QRIS had been routed
   * through the gateway adapter — the one thing this rail must never do, because the
   * gateway is deliberately unconfigured in production and the charge would fail closed.
   */
  assert(pay.body.status === 'PENDING', `qr: QRIS status ${pay.body.status} != PENDING`);
  assert(
    !pay.body.providerReference,
    `qr: QRIS must not hold a gateway reference, got ${JSON.stringify(pay.body.providerReference)}`,
  );

  // The customer is shown where to scan: the routed depot's own payment destination.
  const dest = await api('GET', `/depots/api/v1/depots/${order.depotId}/payment-info`, { token });
  ok(dest, 'qr: read the depot payment destination');
  assert(dest.body.name, `qr: payment destination has no depot name: ${JSON.stringify(dest.body)}`);

  // Nothing has moved yet: the order must not advance off the back of an unconfirmed QRIS.
  const beforeConfirm = await getOrder(staff, order.id);
  assert(
    beforeConfirm.status === 'CREATED',
    `qr: order ${beforeConfirm.status} — an unconfirmed QRIS must not advance it`,
  );

  // Staff watched their own QRIS notification and pressed confirm. Same manual settle as
  // a transfer; that is the whole design.
  const confirmed = await api('POST', `/payments/api/v1/payments/${pay.body.id}/confirm`, { token: staff });
  ok(confirmed, 'qr: staff confirm');
  assert(confirmed.body.status === 'PAID', `qr: after confirm ${confirmed.body.status} != PAID`);

  console.log(`PASSED qris: payment ${pay.body.id} PENDING with no gateway reference, then staff-confirmed PAID`);
}

/*
 * 6. The delivery leg — the half of the money path nothing in CI has ever executed.
 *
 * Scenarios 1 and 2 walk an order to COMPLETED with a staff `PATCH /status` loop, which is
 * precisely the path a real courier never takes. Everything between "a driver is assigned"
 * and "the depot has the cash and the courier has been credited" was therefore covered only
 * by unit tests with in-memory fakes and by a manual UAT run from 2026-07-27 — a run whose
 * settlement, courier-balance and driver-assignment cases were all BLOCKED for want of
 * exactly the fixture state this scenario builds.
 *
 * The order is paid in CASH on delivery, so the money genuinely moves through the courier:
 * confirm the cash, prove the drop, deposit at the depot, have the depot accept it.
 */
async function deliveryLeg(staff) {
  const { productId } = await createProduct(staff);
  const geo = remote(-7.25, 112.75); // Surabaya, jittered
  const depot = await createDepot(staff, { ...geo, deliveryFee: 5000, minOrderAmount: 0, serviceRadiusKm: 5 });
  await createStock(staff, depot.id, productId, 100);
  const driver = await inviteDriver(staff, depot.id);
  const { phone, token } = await registerCustomer();

  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 2 } }), 'dl: add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: {
      deliveryAddress: {
        recipientName: 'DL User', phone, addressLine: 'Jl. Delivery 1',
        city: 'Surabaya', province: 'Jatim', latitude: geo.lat, longitude: geo.lng,
      },
    },
  });
  ok(checkout, 'dl: checkout');
  const order = checkout.body;
  assert(order.depotId === depot.id, `dl: routed to ${order.depotId}, expected ${depot.id}`);

  // COD: the payment exists and stays PENDING until the courier confirms the cash.
  const pay = await api('POST', '/payments/api/v1/payments', {
    token,
    body: { orderId: order.id, method: 'CASH', amount: order.total },
  });
  ok(pay, 'dl: initiate COD payment');

  /*
   * Geofence, both sides of it. Checking in 800 km away must be refused — if it is not, the
   * radius is not being enforced and every later assertion here would still pass.
   */
  const farAway = await api('POST', '/deliveries/api/v1/driver/shifts/check-in', {
    token: driver.token,
    body: { depotId: depot.id, lat: geo.lat + 7, lng: geo.lng },
  });
  assert(farAway.status >= 400, `dl: check-in 800km away should be refused, got ${farAway.status}`);

  const shift = await api('POST', '/deliveries/api/v1/driver/shifts/check-in', {
    token: driver.token,
    body: { depotId: depot.id, lat: geo.lat, lng: geo.lng },
  });
  ok(shift, 'dl: check-in at the depot');
  const shiftId = shift.body.id;
  assert(shiftId, `dl: no shift id: ${JSON.stringify(shift.body)}`);

  const assigned = await api('POST', '/deliveries/api/v1/deliveries', {
    token: staff,
    body: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      driverId: driver.id,
      driverName: 'Integration Kurir',
      depotId: depot.id,
      destinationAddress: 'Jl. Delivery 1, Surabaya',
      destinationLat: geo.lat,
      destinationLng: geo.lng,
      recipientPhone: phone,
    },
  });
  ok(assigned, 'dl: assign driver');
  const deliveryId = assigned.body.id;
  /*
   * The COD amount is read from payment-service, never taken from the caller. An assign
   * body cannot talk the courier into collecting a different number than the customer owes.
   */
  assert(
    assigned.body.codAmount === order.total,
    `dl: codAmount ${assigned.body.codAmount} != order total ${order.total}`,
  );
  assert(
    (await getOrder(staff, order.id)).status === 'DRIVER_ASSIGNED',
    'dl: assigning a driver must advance the order to DRIVER_ASSIGNED',
  );

  ok(
    await api('PATCH', `/deliveries/api/v1/driver/deliveries/${deliveryId}/pickup`, { token: driver.token }),
    'dl: pickup',
  );
  ok(
    await api('PATCH', `/deliveries/api/v1/driver/deliveries/${deliveryId}/start`, { token: driver.token }),
    'dl: start',
  );

  // Cash in hand: overpaid by 20k, so the change is computed rather than assumed.
  const cashGiven = order.total + 20000;
  const cash = await api('POST', `/payments/api/v1/payments/${pay.body.id}/confirm`, {
    token: driver.token,
    body: { cashReceived: cashGiven },
  });
  ok(cash, 'dl: confirm COD cash');
  assert(cash.body.status === 'PAID', `dl: payment ${cash.body.status} != PAID`);
  assert(
    cash.body.changeGiven === 20000,
    `dl: change ${cash.body.changeGiven} != 20000 (received ${cashGiven}, owed ${order.total})`,
  );

  const pod = await api('POST', `/deliveries/api/v1/driver/deliveries/${deliveryId}/complete`, {
    token: driver.token,
    body: {
      photoUrl: 'https://example.invalid/pod.jpg',
      recipientName: 'DL User',
      latitude: geo.lat,
      longitude: geo.lng,
    },
  });
  ok(pod, 'dl: proof of delivery');
  assert(pod.body.status === 'DELIVERED', `dl: delivery ${pod.body.status} != DELIVERED`);

  /*
   * PoD is what closes the order — the bug behind four blocked UAT cases was that it did
   * not. Completion is fire-and-forget across the service boundary, so give it a moment
   * rather than asserting into a race.
   */
  const closed = await eventually(
    () => getOrder(staff, order.id),
    (o) => o.status === 'COMPLETED',
    'dl: order never reached COMPLETED after the PoD',
  );
  assert(closed.status === 'COMPLETED', `dl: order ${closed.status} != COMPLETED after PoD`);

  // The courier deposits the shift's cash; the depot accepts it. The expected total is
  // snapshotted server-side, so a courier cannot name their own number.
  const deposit = await api('POST', '/deliveries/api/v1/driver/settlement', {
    token: driver.token,
    body: { shiftId, depositedAmount: order.total },
  });
  ok(deposit, 'dl: submit settlement');
  assert(
    deposit.body.expectedAmount === order.total,
    `dl: expected ${deposit.body.expectedAmount} != collected ${order.total}`,
  );

  const verified = await api('POST', `/deliveries/api/v1/settlements/${deposit.body.id}/verify`, { token: staff });
  ok(verified, 'dl: verify settlement');
  assert(verified.body.status === 'VERIFIED', `dl: settlement ${verified.body.status} != VERIFIED`);

  // And the courier is actually paid for it — the last hop, and the one UAT could never reach.
  const earnings = await eventually(
    async () => (await api('GET', '/payout/api/v1/courier/earnings/summary', { token: driver.token })).body,
    (e) => Number(e?.availableBalance ?? 0) > 0,
    'dl: courier balance never moved off zero',
  );
  console.log(
    `PASSED delivery-leg: order ${order.id} COD ${order.total} (change 20000) -> PoD -> COMPLETED, ` +
      `settlement VERIFIED, courier balance ${earnings.availableBalance}`,
  );
}

async function main() {
  const staff = staffToken();
  try {
    await coreLoop(staff);
    await depotRoutedLoop(staff);
    await onlineWebhookLoop(staff);
    await failurePaths(staff);
    await qrisLoop(staff);
    await deliveryLeg(staff);
    console.log('\nALL INTEGRATION SCENARIOS PASSED');
  } finally {
    // Runs on failure too: a half-finished run leaves the worst litter.
    await retireCreatedDepots(staff);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
