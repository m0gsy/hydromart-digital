// Core-loop integration assertions, driven through the gateway over real HTTP.
// Run standalone against an already-up stack (`node test/integration/flow.mjs`)
// or via the orchestrator (`npm run test:integration`).
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
// Must equal x-shared JWT_ACCESS_SECRET in docker-compose.test.yml.
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? 'itest-shared-access-secret-0123456789abcdef';
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

async function main() {
  const staff = staffToken();

  // 1. staff creates a catalog product
  const sku = `ITEST-${Date.now()}`;
  const prod = await api('POST', '/products/api/v1/products', {
    token: staff,
    body: { name: 'Integration Galon 19L', sku, unit: 'galon', basePrice: 20000 },
  });
  ok(prod, 'create product');
  const productId = prod.body.id;
  assert(productId, `no product id: ${JSON.stringify(prod.body)}`);

  // 2. customer register -> scrape OTP -> verify
  const phone = `+62811${String(Date.now()).slice(-7)}`;
  ok(await api('POST', '/auth/api/v1/auth/register', { body: { phone, fullName: 'Integration User' } }), 'register');
  const code = await readOtp(phone);
  const verify = await api('POST', '/auth/api/v1/auth/otp/verify', { body: { phone, code, purpose: 'REGISTRATION' } });
  ok(verify, 'verify otp');
  const customer = verify.body.accessToken;
  assert(customer, `no accessToken: ${JSON.stringify(verify.body)}`);

  // 3. cart + checkout (no coords -> routing fails open to flat fee)
  ok(await api('POST', '/orders/api/v1/cart/items', { token: customer, body: { productId, quantity: 2 } }), 'add to cart');
  const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
    token: customer,
    body: { deliveryAddress: { recipientName: 'Integration User', phone, addressLine: 'Jl. Test 1', city: 'Jakarta', province: 'DKI Jakarta' } },
  });
  ok(checkout, 'checkout');
  const orderId = checkout.body.id;
  const total = checkout.body.total;
  assert(orderId && total > 0, `bad checkout: ${JSON.stringify(checkout.body)}`);

  // 4. CASH payment + staff confirm (fires payment->order internal-confirm: CREATED->CONFIRMED)
  const pay = await api('POST', '/payments/api/v1/payments', { token: customer, body: { orderId, method: 'CASH', amount: total } });
  ok(pay, 'initiate payment');
  ok(await api('POST', `/payments/api/v1/payments/${pay.body.id}/confirm`, { token: staff }), 'confirm payment');

  // 5. staff advances the order to COMPLETED (BR-012 forward sequence). Read the
  // current status first: the payment->order auto-confirm is fail-open, so the
  // order may still be CREATED or already CONFIRMED — walk from wherever it is.
  const SEQ = ['CREATED', 'CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED'];
  const cur = (await api('GET', `/orders/api/v1/orders/manage/${orderId}`, { token: staff })).body.status;
  for (let i = SEQ.indexOf(cur) + 1; i < SEQ.length; i++) {
    ok(await api('PATCH', `/orders/api/v1/orders/${orderId}/status`, { token: staff, body: { status: SEQ[i] } }), `advance ${SEQ[i]}`);
  }

  // 6. assertions: order COMPLETED + loyalty awarded across a real service boundary
  const finalOrder = await api('GET', `/orders/api/v1/orders/manage/${orderId}`, { token: staff });
  ok(finalOrder, 'get final order');
  assert(finalOrder.body.status === 'COMPLETED', `order status ${finalOrder.body.status} != COMPLETED`);

  const loyalty = await api('GET', '/loyalty/api/v1/loyalty/me', { token: customer });
  ok(loyalty, 'loyalty me');
  assert(loyalty.body.pointsBalance > 0, `expected points > 0, got ${JSON.stringify(loyalty.body)}`);

  console.log(`PASSED: order ${orderId} COMPLETED, ${loyalty.body.pointsBalance} loyalty points, total ${total}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
