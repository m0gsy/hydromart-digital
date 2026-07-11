// Integration assertions driven through the gateway over real HTTP. Run against
// an already-up stack (`node test/integration/flow.mjs`) or via the orchestrator
// (`npm run test:integration`). Covers four scenarios end to end:
//   1. core loop      — register -> checkout -> cash pay/confirm -> complete -> loyalty
//   2. depot-routed    — per-depot delivery fee + stock reserve at checkout + deduct on complete
//   3. online webhook  — QRIS charge (stubbed gateway) -> signed PAID webhook -> order CONFIRMED
//   4. failure paths   — below-minimum / out-of-service-area / insufficient-stock all rejected 422
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
function signWebhook(reference, event) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${reference}.${event}`).digest('hex');
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
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
    body: { name: 'Integration Galon 19L', sku, unit: 'galon', basePrice },
  });
  ok(res, 'create product');
  assert(res.body.id, `no product id: ${JSON.stringify(res.body)}`);
  return { productId: res.body.id, sku, basePrice };
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
  assert(verify.body.accessToken, `no accessToken: ${JSON.stringify(verify.body)}`);
  return { phone, token: verify.body.accessToken };
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
async function coreLoop(staff) {
  const { productId } = await createProduct(staff);
  const { phone, token } = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 2 } }), 'add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: { deliveryAddress: { recipientName: 'Integration User', phone, addressLine: 'Jl. Test 1', city: 'Jakarta', province: 'DKI Jakarta' } },
  });
  ok(checkout, 'checkout');
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
  assert(order.deliveryFee === 7000, `dr: per-depot fee ${order.deliveryFee} != 7000 (flat is 5000)`);
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

// 3. Online payment: QRIS charge succeeds via the gateway stub (PENDING+reference);
//    a bad-signature webhook is rejected; a signed PAID webhook confirms the order.
async function onlineWebhookLoop(staff) {
  const { productId } = await createProduct(staff);
  const { phone, token } = await registerCustomer();
  ok(await api('POST', '/orders/api/v1/cart/items', { token, body: { productId, quantity: 1 } }), 'ow: add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token,
    body: { deliveryAddress: { recipientName: 'OW User', phone, addressLine: 'Jl. OW 1', city: 'Jakarta', province: 'DKI Jakarta' } },
  });
  ok(checkout, 'ow: checkout');
  const orderId = checkout.body.id;

  const pay = await api('POST', '/payments/api/v1/payments', { token, body: { orderId, method: 'QRIS', amount: checkout.body.total } });
  ok(pay, 'ow: initiate online payment');
  const reference = pay.body.reference;
  assert(pay.body.status === 'PENDING' && reference, `ow: expected PENDING+reference, got ${JSON.stringify(pay.body)}`);

  // Bad signature is rejected (InvalidWebhookSignatureError -> 401).
  const bad = await api('POST', '/payments/api/v1/payments/webhook', { body: { reference, event: 'PAID', signature: 'deadbeef' } });
  assert(bad.status === 401, `ow: bad-signature webhook expected 401, got ${bad.status}`);

  // Signed PAID webhook settles the payment and confirms the order (payment -> order internal-confirm).
  const good = await api('POST', '/payments/api/v1/payments/webhook', {
    body: { reference, event: 'PAID', signature: signWebhook(reference, 'PAID') },
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

  console.log('PASSED failure-paths: below-min 422, out-of-area 422, insufficient-stock 422');
}

async function main() {
  const staff = staffToken();
  await coreLoop(staff);
  await depotRoutedLoop(staff);
  await onlineWebhookLoop(staff);
  await failurePaths(staff);
  console.log('\nALL INTEGRATION SCENARIOS PASSED');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
