# Cross-Service Integration Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single command (`npm run test:integration`) that boots all 15 services from their real Dockerfiles + Postgres + Redis, then drives the core transaction loop through the gateway over real HTTP and asserts cross-service effects.

**Architecture:** A `docker-compose.test.yml` override (merged onto the existing base `docker-compose.yml`) adds all 15 service containers on the base network. A Node orchestrator (`run.mjs`) brings up infra, applies migrations from the host, boots the services, waits for every `/health`, runs the flow, and tears down. `flow.mjs` performs the register→checkout→pay→complete happy path and asserts.

**Tech Stack:** Docker Compose, Node 20 (native `fetch`, `node:assert`, `child_process`, `node:crypto` for the self-signed staff JWT), existing per-service Dockerfiles + `npm run db:migrate`.

## Global Constraints

- No production code changes. Only new files + one root `package.json` script.
- Shared secrets are single-sourced: `JWT_ACCESS_SECRET` and `INTERNAL_SERVICE_KEY` are byte-identical across every service in the compose file (the drift that broke cross-service auth before).
- Each service reads its own `<SVC>_DATABASE_URL` (not `DATABASE_URL`) and its own `<SVC>_SERVICE_PORT` (gateway: `GATEWAY_PORT`, auth: `AUTH_SERVICE_PORT`).
- Container DB host is `postgres:5432`; cross-service URLs use compose service hostnames (`http://order:3004`, etc.).
- Ports: auth 3001, customer 3002, product 3003, order 3004, payment 3005, delivery 3006, depot 3007, dashboard 3008, loyalty 3009, promo 3010, referral 3011, crm 3012, recommendation 3013, forecast 3014, gateway 8080.
- Only the gateway publishes a host port (`8080:8080`). All inter-service traffic stays on the compose network.
- Docker `CMD` stays `node dist/src/main.js` (Linux; `--preserve-symlinks` is a Windows-dev-only workaround, not needed in-container).
- `JWT_ACCESS_SECRET` must be ≥32 chars; `PAYMENT_WEBHOOK_SECRET` ≥16 chars (validation floors).

---

### Task 1: `docker-compose.test.yml` — all 15 services boot healthy

This is the boot-proof deliverable. When it's done, `docker compose ... up` must bring every service to a healthy state — the exact step the 3 past boot bugs failed.

**Files:**
- Create: `docker-compose.test.yml`

**Interfaces:**
- Consumes: base `docker-compose.yml` (`postgres` with `init-databases.sql`, `redis`), each `services/<svc>/Dockerfile`, `infra/postgres/init-databases.sql` (creates all 13 DBs).
- Produces: a merged compose stack; gateway reachable at `http://localhost:8080`; every app service reachable in-network at `http://<svc>:<port>` and reporting healthy.

- [ ] **Step 1: Write the compose override**

Create `docker-compose.test.yml`. Health path: app services use `/api/v1/health` (global prefix `api/v1` is set app-wide; verified for forecast-service), gateway uses `/health` (gateway has no global prefix). The healthcheck uses `node` (present in the runtime image; alpine has no curl). If any single service's health controller turns out to sit at a different path, fix that one service's healthcheck path — don't change the app.

```yaml
# Integration-test overlay. Merge with the base file:
#   docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
# Base file provides postgres (with init-databases.sql creating all 13 DBs) + redis.

x-shared: &shared
  NODE_ENV: production
  JWT_ACCESS_SECRET: itest-shared-access-secret-0123456789abcdef
  INTERNAL_SERVICE_KEY: itest-shared-internal-key-0123456789

x-svc: &svc
  restart: "no"
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }

services:
  auth:
    <<: *svc
    build: { context: ., dockerfile: services/auth-service/Dockerfile }
    environment:
      <<: *shared
      AUTH_SERVICE_PORT: 3001
      AUTH_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_auth?schema=public
      JWT_REFRESH_SECRET: itest-shared-refresh-secret-0123456789abcdef
      JWT_ACCESS_TTL: 900
      JWT_REFRESH_TTL: 2592000
      OTP_TTL_SECONDS: 300
      OTP_LENGTH: 6
      OTP_MAX_ATTEMPTS: 5
      OTP_RESEND_COOLDOWN_SECONDS: 60
      OTP_DELIVERY_CHANNEL: console
      CRM_SERVICE_URL: http://crm:3012
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  customer:
    <<: *svc
    build: { context: ., dockerfile: services/customer-service/Dockerfile }
    environment:
      <<: *shared
      CUSTOMER_SERVICE_PORT: 3002
      CUSTOMER_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_customer?schema=public
      MAX_ADDRESSES_PER_CUSTOMER: 20
      LOYALTY_SERVICE_URL: http://loyalty:3009
      BIRTHDAY_REWARD_POINTS: 250
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3002/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  product:
    <<: *svc
    build: { context: ., dockerfile: services/product-service/Dockerfile }
    environment:
      <<: *shared
      PRODUCT_SERVICE_PORT: 3003
      PRODUCT_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_product?schema=public
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3003/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  order:
    <<: *svc
    build: { context: ., dockerfile: services/order-service/Dockerfile }
    environment:
      <<: *shared
      ORDER_SERVICE_PORT: 3004
      ORDER_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_order?schema=public
      PRODUCT_SERVICE_URL: http://product:3003
      DEPOT_SERVICE_URL: http://depot:3007
      LOYALTY_SERVICE_URL: http://loyalty:3009
      PROMO_SERVICE_URL: http://promo:3010
      REFERRAL_SERVICE_URL: http://referral:3011
      CRM_SERVICE_URL: http://crm:3012
      RECOMMENDATION_SERVICE_URL: http://recommendation:3013
      FORECAST_SERVICE_URL: http://forecast:3014
      ORDER_DELIVERY_FEE: 5000
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3004/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  payment:
    <<: *svc
    build: { context: ., dockerfile: services/payment-service/Dockerfile }
    environment:
      <<: *shared
      PAYMENT_SERVICE_PORT: 3005
      PAYMENT_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_payment?schema=public
      PAYMENT_GATEWAY_BASE_URL: ""
      PAYMENT_GATEWAY_API_KEY: ""
      PAYMENT_WEBHOOK_SECRET: itest-webhook-secret-min-16-chars
      ORDER_SERVICE_URL: http://order:3004
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3005/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  delivery:
    <<: *svc
    build: { context: ., dockerfile: services/delivery-service/Dockerfile }
    environment:
      <<: *shared
      DELIVERY_SERVICE_PORT: 3006
      DELIVERY_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_delivery?schema=public
      ORDER_SERVICE_URL: http://order:3004
      MAX_ACTIVE_DELIVERIES_PER_DRIVER: 1
      DELIVERY_SLA_MINUTES: 120
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3006/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  depot:
    <<: *svc
    build: { context: ., dockerfile: services/depot-service/Dockerfile }
    environment:
      <<: *shared
      DEPOT_SERVICE_PORT: 3007
      DEPOT_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_depot?schema=public
      CRM_SERVICE_URL: http://crm:3012
      DEPOT_ALERT_PHONE: ""
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3007/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  dashboard:
    build: { context: ., dockerfile: services/dashboard-service/Dockerfile }
    restart: "no"
    environment:
      <<: *shared
      DASHBOARD_SERVICE_PORT: 3008
      ORDER_SERVICE_URL: http://order:3004
      DELIVERY_SERVICE_URL: http://delivery:3006
      DEPOT_SERVICE_URL: http://depot:3007
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3008/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  loyalty:
    <<: *svc
    build: { context: ., dockerfile: services/loyalty-service/Dockerfile }
    environment:
      <<: *shared
      LOYALTY_SERVICE_PORT: 3009
      LOYALTY_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_loyalty?schema=public
      LOYALTY_EARN_RATE_RUPIAH: 1000
      LOYALTY_POINT_EXPIRY_MONTHS: 12
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3009/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  promo:
    <<: *svc
    build: { context: ., dockerfile: services/promo-service/Dockerfile }
    environment:
      <<: *shared
      PROMO_SERVICE_PORT: 3010
      PROMO_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_promo?schema=public
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3010/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  referral:
    <<: *svc
    build: { context: ., dockerfile: services/referral-service/Dockerfile }
    environment:
      <<: *shared
      REFERRAL_SERVICE_PORT: 3011
      REFERRAL_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_referral?schema=public
      LOYALTY_SERVICE_URL: http://loyalty:3009
      REFERRAL_REFERRER_POINTS: 500
      REFERRAL_REFEREE_POINTS: 250
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3011/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  crm:
    <<: *svc
    build: { context: ., dockerfile: services/crm-service/Dockerfile }
    environment:
      <<: *shared
      CRM_SERVICE_PORT: 3012
      CRM_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_crm?schema=public
      WHATSAPP_API_URL: ""
      WHATSAPP_API_TOKEN: ""
      CUSTOMER_SERVICE_URL: http://customer:3002
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3012/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  recommendation:
    <<: *svc
    build: { context: ., dockerfile: services/recommendation-service/Dockerfile }
    environment:
      <<: *shared
      RECOMMENDATION_SERVICE_PORT: 3013
      RECOMMENDATION_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_recommendation?schema=public
      ORDER_SERVICE_URL: http://order:3004
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3013/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  forecast:
    <<: *svc
    build: { context: ., dockerfile: services/forecast-service/Dockerfile }
    environment:
      <<: *shared
      FORECAST_SERVICE_PORT: 3014
      FORECAST_DATABASE_URL: postgresql://hydromart:hydromart@postgres:5432/hydromart_forecast?schema=public
      CHURN_WINDOW_DAYS: 45
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3014/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12

  gateway:
    build: { context: ., dockerfile: services/gateway-service/Dockerfile }
    restart: "no"
    environment:
      <<: *shared
      GATEWAY_PORT: 8080
      AUTH_SERVICE_URL: http://auth:3001
      CUSTOMER_SERVICE_URL: http://customer:3002
      PRODUCT_SERVICE_URL: http://product:3003
      ORDER_SERVICE_URL: http://order:3004
      PAYMENT_SERVICE_URL: http://payment:3005
      DELIVERY_SERVICE_URL: http://delivery:3006
      DEPOT_SERVICE_URL: http://depot:3007
      DASHBOARD_SERVICE_URL: http://dashboard:3008
      LOYALTY_SERVICE_URL: http://loyalty:3009
      PROMO_SERVICE_URL: http://promo:3010
      REFERRAL_SERVICE_URL: http://referral:3011
      CRM_SERVICE_URL: http://crm:3012
      RECOMMENDATION_SERVICE_URL: http://recommendation:3013
      FORECAST_SERVICE_URL: http://forecast:3014
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 12
```

- [ ] **Step 2: Bring up infra + migrate (prereq for the boot check)**

Run (Docker must be up):
```bash
docker compose up -d postgres redis
# wait ~10s for the healthchecks, then apply all 13 schemas to the compose Postgres:
npm run db:migrate
```
Expected: `db:migrate` runs `prisma migrate deploy` per workspace and reports each DB up to date (no error). If a service reports "database does not exist", the base `postgres` volume predates a service — `docker compose down -v` and retry so `init-databases.sql` re-runs.

- [ ] **Step 3: Build + boot all services and verify every one is healthy**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
# give it up to ~2 min, then:
docker compose -f docker-compose.yml -f docker-compose.test.yml ps
```
Expected: all 15 app services plus postgres/redis show `Up (healthy)`. This is the boot-proof. If any service is `unhealthy`/`restarting`, inspect it:
```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml logs <svc> --tail 40
```
Common causes to check first: a wrong health path (fix that service's healthcheck), a missing env var (add it), a Prisma-client-not-in-dist regression (postbuild copy), or a shared-secret mismatch (all must equal the `x-shared` values).

- [ ] **Step 4: Smoke the gateway from the host**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/health
```
Expected: `200`.

- [ ] **Step 5: Tear down and commit**

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml down
git add docker-compose.test.yml
git commit -m "test(integration): compose overlay booting all 15 services"
```

---

### Task 2: Orchestrator `run.mjs` + `test:integration` script

Wraps Task 1's manual steps into one command, with a trivial flow stub so the orchestrator is end-to-end runnable before the real assertions exist.

**Files:**
- Create: `test/integration/run.mjs`
- Create: `test/integration/flow.mjs` (stub in this task; filled in Task 3)
- Modify: root `package.json` (add `test:integration` script)

**Interfaces:**
- Consumes: `docker-compose.test.yml` (Task 1), `npm run db:migrate`.
- Produces: `run.mjs` exit code 0 on full green; it invokes `flow.mjs` as a child process and forwards its exit code. `flow.mjs` exports nothing — it is a script that exits non-zero on assertion failure. `run.mjs` accepts a `--keep` flag to skip teardown.

- [ ] **Step 1: Write the flow stub**

Create `test/integration/flow.mjs`:
```js
// Filled in Task 3. For now just prove the gateway is reachable.
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const res = await fetch(`${GATEWAY}/health`);
if (!res.ok) {
  console.error(`gateway /health returned ${res.status}`);
  process.exit(1);
}
console.log('flow stub OK: gateway healthy');
```

- [ ] **Step 2: Write the orchestrator**

Create `test/integration/run.mjs`:
```js
import { spawnSync } from 'node:child_process';

const KEEP = process.argv.includes('--keep');
const BASE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml'];
const SERVICES = ['auth','customer','product','order','payment','delivery','depot','dashboard','loyalty','promo','referral','crm','recommendation','forecast','gateway'];
const PORTS = { auth:3001,customer:3002,product:3003,order:3004,payment:3005,delivery:3006,depot:3007,dashboard:3008,loyalty:3009,promo:3010,referral:3011,crm:3012,recommendation:3013,forecast:3014 };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  return r.status ?? 1;
}
function compose(args, opts) { return sh('docker', ['compose', ...args], opts); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(name, path, port, tries = 30) {
  for (let i = 0; i < tries; i++) {
    // exec the check INSIDE the container network via the running service
    const r = spawnSync('docker', ['compose', ...BASE, 'exec', '-T', name, 'node', '-e',
      `fetch('http://localhost:${port}${path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`],
      { stdio: 'ignore', shell: process.platform === 'win32' });
    if (r.status === 0) return true;
    await sleep(4000);
  }
  return false;
}

async function main() {
  // 1. infra
  if (compose(['up', '-d', 'postgres', 'redis'])) throw new Error('infra up failed');
  await sleep(8000);
  // 2. migrations (host, against the compose Postgres on localhost:5432)
  if (sh('npm', ['run', 'db:migrate'])) throw new Error('db:migrate failed');
  // 3. build + boot all services
  if (compose([...BASE, 'up', '-d', '--build'])) throw new Error('service boot failed');
  // 4. wait for every service healthy (the boot-proof)
  for (const s of SERVICES) {
    const path = s === 'gateway' ? '/health' : '/api/v1/health';
    const port = s === 'gateway' ? 8080 : PORTS[s];
    process.stdout.write(`waiting for ${s} ... `);
    if (!(await waitHealthy(s, path, port))) {
      compose([...BASE, 'logs', s, '--tail', '40']);
      throw new Error(`${s} never became healthy`);
    }
    console.log('healthy');
  }
  // 5. run the flow
  const flow = sh('node', ['test/integration/flow.mjs']);
  if (flow) throw new Error('flow assertions failed');
  console.log('\nINTEGRATION TEST PASSED');
}

main()
  .then(() => process.exitCode = 0)
  .catch((e) => { console.error('\nINTEGRATION TEST FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { if (!KEEP) compose([...BASE, 'down']); });
```

- [ ] **Step 3: Add the root script**

In root `package.json` `scripts`, add:
```json
"test:integration": "node test/integration/run.mjs"
```

- [ ] **Step 4: Run it end-to-end**

Run (Docker up):
```bash
npm run test:integration
```
Expected: infra up → migrate → build/boot → each service prints `healthy` → `flow stub OK: gateway healthy` → `INTEGRATION TEST PASSED` → teardown → exit 0. If a service hangs on `waiting for <svc>`, its logs print automatically; fix per Task 1 Step 3.

- [ ] **Step 5: Commit**

```bash
git add test/integration/run.mjs test/integration/flow.mjs package.json
git commit -m "test(integration): orchestrator + test:integration script"
```

---

### Task 3: `flow.mjs` — the core-loop assertions

Replaces the stub with the real happy path. All HTTP goes through the gateway.

**Files:**
- Modify: `test/integration/flow.mjs`

**Interfaces:**
- Consumes: gateway at `http://localhost:8080`; the shared `JWT_ACCESS_SECRET` and `INTERNAL_SERVICE_KEY` values from `docker-compose.test.yml` (`x-shared`); `docker compose ... logs auth` for the OTP.
- Produces: exit 0 iff the order reaches `COMPLETED` and the customer's loyalty `pointsBalance > 0`; non-zero with a step-named error otherwise.

- [ ] **Step 1: Write the self-signed staff JWT helper**

Confirm the exact access-token claim shape auth mints before writing this — read `services/auth-service/src/` for where the access token is signed (claim names: `sub`, `roles`, `phone`, and whether it's HS256). Then in `flow.mjs`:
```js
import crypto from 'node:crypto';

const SECRET = 'itest-shared-access-secret-0123456789abcdef'; // must equal x-shared JWT_ACCESS_SECRET
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function staffToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: crypto.randomUUID(), roles: ['SUPER_ADMIN'], phone: '+620000000000', iat: now, exp: now + 900 };
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
```
(If auth signs with a different claim name for roles — e.g. `role` singular — match it here; the whole point is these tokens must pass the platform guard.)

- [ ] **Step 2: Write HTTP + OTP helpers**

Append to `flow.mjs`:
```js
import { spawnSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const BASE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml'];

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
function assertStatus(res, want, step) {
  assert(res.status === want, `${step}: expected ${want}, got ${res.status} — ${JSON.stringify(res.body)}`);
}

function readOtp(phone, tries = 10) {
  // auth logs: [DEV OTP] REGISTRATION code for <phone>: NNNNNN
  for (let i = 0; i < tries; i++) {
    const r = spawnSync('docker', ['compose', ...BASE, 'logs', '--no-log-prefix', 'auth'],
      { encoding: 'utf8', shell: process.platform === 'win32' });
    const logs = (r.stdout || '') + (r.stderr || '');
    const re = new RegExp(`REGISTRATION code for \\${phone}:\\s*(\\d{4,8})`);
    const matches = [...logs.matchAll(new RegExp(re, 'g'))];
    if (matches.length) return matches[matches.length - 1][1];
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', [process.platform === 'win32' ? '/t 1' : '1'], { shell: true });
  }
  throw new Error(`OTP for ${phone} not found in auth logs`);
}
```
Before relying on the regex, confirm the exact OTP log line in `services/auth-service/src/` (the console OTP adapter) — adjust the `RegExp` to the real format (phone in E.164, possible ANSI color codes around it from pino-pretty; strip ANSI with `.replace(/\x1b\[[0-9;]*m/g,'')` on `logs` if present).

- [ ] **Step 3: Write the flow body**

Replace the stub with the full path. Confirm each endpoint path + request DTO against the services before finalizing (product create body, checkout DTO address fields, payment initiate DTO, status PATCH body). Skeleton:
```js
const staff = staffToken();

// 1. staff creates a product
const prod = await api('POST', '/products/api/v1/products', {
  token: staff,
  body: { name: 'Galon 19L', sku: `ITEST-${Date.now()}`, unit: 'galon', basePrice: 20000, categoryId: null /* set per DTO */ },
});
assertStatus(prod, 201, 'create product');
const productId = prod.body.id;
const price = prod.body.basePrice;

// 2. customer register -> OTP -> verify
const phone = `+62811${String(Date.now()).slice(-7)}`;
const reg = await api('POST', '/auth/api/v1/auth/register', { body: { phone, fullName: 'Itest User' /* + password if required */ } });
assert(reg.status === 200 || reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
const code = readOtp(phone);
const verify = await api('POST', '/auth/api/v1/auth/otp/verify', { body: { phone, code, purpose: 'REGISTRATION' } });
assert(verify.status === 200 || verify.status === 201, `verify: ${verify.status} ${JSON.stringify(verify.body)}`);
const customer = verify.body.accessToken ?? verify.body.tokens?.accessToken;
assert(customer, `no accessToken in verify response: ${JSON.stringify(verify.body)}`);

// 3. cart + checkout
assertStatus(await api('POST', '/orders/api/v1/cart/items', { token: customer, body: { productId, quantity: 2 } }), 201, 'add to cart');
const checkout = await api('POST', '/orders/api/v1/orders/checkout', {
  token: customer,
  body: { address: { label: 'Home', recipientName: 'Itest', phone, addressLine: 'Jl. Test 1', city: 'Jakarta', province: 'DKI' } },
});
assertStatus(checkout, 201, 'checkout');
const orderId = checkout.body.id;
const total = checkout.body.total;

// 4. CASH payment + staff confirm
const pay = await api('POST', '/payments/api/v1/payments', { token: customer, body: { orderId, method: 'CASH', amount: total } });
assertStatus(pay, 201, 'initiate payment');
assertStatus(await api('POST', `/payments/api/v1/payments/${pay.body.id}/confirm`, { token: staff }), 200, 'confirm payment');

// 5. staff advances CONFIRMED -> COMPLETED (BR-012 forward sequence)
for (const to of ['PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED']) {
  assertStatus(await api('PATCH', `/orders/api/v1/orders/${orderId}/status`, { token: staff, body: { status: to } }), 200, `advance ${to}`);
}

// 6. assertions
const finalOrder = await api('GET', `/orders/api/v1/orders/manage/${orderId}`, { token: staff });
assertStatus(finalOrder, 200, 'get final order');
assert(finalOrder.body.status === 'COMPLETED', `order status ${finalOrder.body.status} != COMPLETED`);

const loyalty = await api('GET', '/loyalty/api/v1/loyalty/me', { token: customer });
assertStatus(loyalty, 200, 'loyalty me');
assert(loyalty.body.pointsBalance > 0, `expected points > 0, got ${loyalty.body.pointsBalance}`);

console.log(`PASSED: order ${orderId} COMPLETED, ${loyalty.body.pointsBalance} loyalty points`);
```
Every `/* per DTO */` marker means: open the target service's DTO/controller and use the real field names before running. Do not leave guesses in — the flow must reflect the actual contracts.

- [ ] **Step 4: Run the full test**

Run:
```bash
npm run test:integration
```
Expected: `... PASSED: order <id> COMPLETED, N loyalty points` then `INTEGRATION TEST PASSED`, exit 0. Iterate against real responses: when a step fails, its error prints the status + body — fix the request shape (not the assertion) and rerun. Use `npm run test:integration -- --keep` to leave the stack up between iterations and re-run just `node test/integration/flow.mjs` for speed.

- [ ] **Step 5: Commit**

```bash
git add test/integration/flow.mjs
git commit -m "test(integration): core-loop happy path (register->checkout->pay->complete)"
```

---

## Self-Review

**Spec coverage:**
- Boot all 15 + fail if any unhealthy → Task 1 (Step 3) + Task 2 (Step 4 health loop). ✓
- Migrations from host → Task 2 Step 2. ✓
- Self-signed staff JWT → Task 3 Step 1. ✓
- Real register→OTP-scrape→verify → Task 3 Steps 2–3. ✓
- Cart→checkout→CASH pay→staff confirm→advance to COMPLETED → Task 3 Step 3. ✓
- Assert COMPLETED + loyalty points > 0 → Task 3 Step 3. ✓
- `test:integration` command, teardown, `--keep` → Task 2. ✓
- No production code changes → all tasks only add files / one script. ✓
- Ceilings (depot/reservation, online webhook, failure paths, CI, migrate container) → left unbuilt by design; documented in spec.

**Placeholder scan:** The `/* per DTO */` and claim-shape/OTP-regex notes are deliberate verification points, not placeholders — each names the exact file to read and what to confirm. Endpoint paths, env matrix, ports, and compose are concrete.

**Type consistency:** Compose `x-shared` secret values match the `SECRET` constant in Task 3 Step 1 (`itest-shared-access-secret-0123456789abcdef`). Service hostnames/ports in the compose match `PORTS`/`SERVICES` in `run.mjs`. Health paths (`/api/v1/health` app, `/health` gateway) are consistent between Task 1 healthchecks and Task 2's wait loop.

## Known verification points for the implementer (resolve while coding, don't guess)

1. **Health path** per service — assumed `/api/v1/health`; forecast + gateway confirmed. If any service 404s its healthcheck, correct that service's path.
2. **Auth access-token claim shape** — role claim name (`roles` vs `role`), token location in the verify response (`accessToken` vs `tokens.accessToken`), and whether register/verify require a `password`.
3. **OTP log format** — exact string + possible ANSI codes from pino-pretty.
4. **DTO field names** — product create, checkout address, payment initiate, status PATCH. Read the controllers/DTOs.
5. **Alpine healthcheck runtime** — `node -e "fetch(...)"` assumes global `fetch` (Node 18+; runtime is node:20-alpine ✓).
