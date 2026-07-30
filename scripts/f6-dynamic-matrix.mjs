// F6 item 4: the capability matrix is live, and the two dependency outages fail in
// OPPOSITE directions on purpose.
//
//   node scripts/f6-dynamic-matrix.mjs
//
// Checks, in order:
//   1. revoke a capability from a role -> within one TTL the Nest guard refuses it
//   2. restore it -> within one TTL the guard allows it again
//   3. auth-service DOWN -> services keep serving the last matrix (fail OPEN to the
//      compiled defaults). A wobble in the override source must not lock the fleet
//      out of itself.
//   4. depot-service DOWN -> a multi-depot role gets 503, never a wildcard. There is
//      no safe default for "which depots may this person see".
//
// Stops and restarts containers, so it is destructive to a running stack's uptime but
// not to its data. Exit code is the number of failed checks.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
//   MATRIX_TTL_SECONDS  default 30 — the refresher's poll interval
//   COMPOSE             docker compose invocation, default reads COMPOSE_FILES below
import crypto from 'node:crypto';
import { fetchThrottled } from './lib/http.mjs';
import { execSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const TTL = Number(process.env.MATRIX_TTL_SECONDS ?? 30);
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(role, sub = crypto.randomUUID(), depotId = null) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, phone: '+620000000000', depotId, iat: now, exp: now + 3600 })}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}

async function call(path, token, init = {}) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status };
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const docker = (args) => execSync(`docker ${args}`, { stdio: 'pipe' }).toString().trim();

let failed = 0;
let passed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const ADMIN = tokenFor('SUPER_ADMIN');
// staffDirectory is a good probe: MANAGER holds it by default, it is a plain GET, and
// revoking it cannot break anything else mid-run.
const PROBE = { capability: 'staffDirectory', role: 'MANAGER', path: '/auth/api/v1/auth/staff?limit=1' };

async function reachable(role) {
  const res = await call(PROBE.path, tokenFor(role));
  return res.status !== 403;
}

/** Poll until the predicate holds or the window expires — the TTL is a ceiling, not a wait. */
async function within(seconds, predicate) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(2);
  }
}

async function liveMatrix() {
  console.log(`\n— live matrix (TTL ${TTL}s)`);
  check(`${PROBE.role} starts with ${PROBE.capability}`, await reachable(PROBE.role));

  // Revoke: hand the capability to SUPER_ADMIN only.
  await call(`/auth/api/v1/access/matrix/${PROBE.capability}`, ADMIN, {
    method: 'PUT',
    body: JSON.stringify({ roles: ['SUPER_ADMIN'] }),
  });
  check(
    `revoking it reaches the guard within ${TTL + 15}s`,
    await within(TTL + 15, async () => !(await reachable(PROBE.role))),
  );

  // Restore by DELETING the override rather than writing the defaults back, so the
  // table only ever holds real deviations.
  await call(`/auth/api/v1/access/matrix/${PROBE.capability}`, ADMIN, { method: 'DELETE' });
  check(
    `restoring it reaches the guard within ${TTL + 15}s`,
    await within(TTL + 15, () => reachable(PROBE.role)),
  );
}

async function authDown() {
  console.log('\n— auth-service down (must fail OPEN to the compiled matrix)');
  const container = docker(`ps --filter name=hydromart-auth --format {{.Names}}`).split('\n')[0];
  if (!container) {
    check('auth container found', false, 'no hydromart-auth-* container');
    return;
  }
  docker(`stop ${container}`);
  try {
    await sleep(TTL + 5); // let at least one refresh fail
    // Another service must still answer using the matrix it already holds. The probe has to be a
    // capability HEAD_OFFICE actually holds in the compiled defaults — `depotAdmin` is
    // MANAGER + SUPER_ADMIN only, so /depots/manage 403s head office whether auth is up or not,
    // which would read as a fail-closed that never happened. orderQueue includes HEAD_OFFICE, and
    // a network-wide role needs no depot resolution either.
    const res = await call('/orders/api/v1/orders/manage?limit=1', tokenFor('HEAD_OFFICE'));
    check('another service still serves its last known matrix', res.status === 200, `got ${res.status}`);
  } finally {
    docker(`start ${container}`);
    await within(90, async () => (await call('/auth/api/v1/access/matrix', ADMIN)).status === 200);
  }
}

async function depotDown() {
  console.log('\n— depot-service down (must fail CLOSED for a multi-depot role)');
  const container = docker(`ps --filter name=hydromart-depot --format {{.Names}}`).split('\n')[0];
  if (!container) {
    check('depot container found', false, 'no hydromart-depot-* container');
    return;
  }
  docker(`stop ${container}`);
  try {
    await sleep(3);
    // An order listing for a SUPERVISOR needs a resolved depot set. With the resolver
    // unreachable there is no safe answer: 503, never "all depots".
    const res = await call('/orders/api/v1/orders?limit=1', tokenFor('SUPERVISOR'));
    check(
      'a supervisor gets 503 rather than an unscoped result',
      res.status === 503,
      `got ${res.status}`,
    );
    // A depot-LOCKED role reads its depot off the token and needs no resolver.
    const locked = await call('/orders/api/v1/orders?limit=1', tokenFor('KEPALA_DEPOT', crypto.randomUUID(), crypto.randomUUID()));
    check('a depot-locked role is unaffected', locked.status !== 503, `got ${locked.status}`);
  } finally {
    docker(`start ${container}`);
    await within(90, async () => (await call('/depots/api/v1/depots?limit=1', null)).status === 200);
  }
}

async function main() {
  await liveMatrix();
  await authDown();
  await depotDown();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
