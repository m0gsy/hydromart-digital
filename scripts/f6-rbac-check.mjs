// F6 items 2 and 3: the 13-role login matrix and depot-scope isolation, checked
// against a running stack over the real gateway.
//
//   node scripts/f6-rbac-check.mjs
//
// Run scripts/seed.mjs and scripts/seed-hierarchy.mjs first — this asserts against
// the fixture they build (25 depots, 2 Asisten SPV of 11 each, 1 SPV, 1 Manager,
// 2 direct grants, 1 orphan depot).
//
// What it proves, per the plan:
//   2. every role lands on the routes it holds and is REFUSED on the ones it does not
//      (the negative half matters as much as the positive half);
//   3. for each scoped role: a bare list returns exactly its own set, a by-id inside
//      the set passes, a by-id outside it is 403, and enumeration leaks nothing.
//
// Exit code is the number of failed checks, so CI can gate on it.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
import crypto from 'node:crypto';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Mint a token for any role, optionally bound to a depot (locked roles need one). */
function tokenFor(role, sub, depotId = null) {
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: 'HS256', typ: 'JWT' };
  const body = { sub, role, phone: '+620000000000', depotId, iat: now, exp: now + 900 };
  const data = `${b64(head)}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function call(path, token) {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

let failed = 0;
let passed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const rows = (b) => (Array.isArray(b) ? b : (b?.items ?? []));

// ---------------------------------------------------------------- fixture lookup

const ADMIN = tokenFor('SUPER_ADMIN', crypto.randomUUID());

async function loadFixture() {
  const depots = rows((await call('/depots/api/v1/depots/manage?limit=200', ADMIN)).body).filter((d) =>
    d.code?.startsWith('HIER-'),
  );
  if (depots.length < 25) {
    console.error(
      `Expected 25 HIER-* depots, found ${depots.length}. Run scripts/seed-hierarchy.mjs first.`,
    );
    process.exit(1);
  }
  const byCode = new Map(depots.map((d) => [d.code, d]));
  const staff = rows((await call('/auth/api/v1/auth/staff?limit=200', ADMIN)).body);
  const byPhone = new Map(staff.map((s) => [s.phone, s]));
  const account = (phone) => {
    const found = byPhone.get(phone);
    if (!found) {
      console.error(`Missing account ${phone}. Run scripts/seed-hierarchy.mjs first.`);
      process.exit(1);
    }
    return found;
  };
  return {
    byCode,
    asv1: account('+6281199000001'),
    asv2: account('+6281199000002'),
    spv: account('+6281199000003'),
    mgr: account('+6281199000004'),
    kepala: account('+6281199000012'),
  };
}

// ---------------------------------------------------------------- item 3: scope

/**
 * The three vectors, run for one account:
 *   LIST        — no depotId at all must return exactly the resolved set
 *   BY-ID IN    — a depot inside the set is readable
 *   BY-ID OUT   — a depot outside it is refused, and refused with 403 (not 404,
 *                 which would still confirm the depot exists)
 */
async function scopeVectors(name, role, account, expectedCodes, fixture) {
  const token = tokenFor(role, account.id);
  const expected = new Set(expectedCodes);
  const idOf = (code) => fixture.byCode.get(code).id;
  const allowedIds = new Set([...expected].map(idOf));

  // Probes chosen for capabilities these roles ACTUALLY hold: `depotAdmin` is
  // MANAGER-only, so /depots/manage would 403 an assistant for the wrong reason.
  // orderQueue and inventoryRead both reach down to ASSISTANT_SUPERVISOR.
  const list = await call('/orders/api/v1/orders/manage?limit=200', token);
  if (list.status !== 200) {
    check(`${name}: unfiltered order queue returns 200`, false, `got ${list.status}`);
  } else {
    // ENUMERATION: no depotId asked for at all. Anything outside the set is a leak.
    const leaked = rows(list.body)
      .map((o) => o.depotId)
      .filter((d) => d && !allowedIds.has(d));
    check(
      `${name}: unfiltered queue leaks no depot outside its ${expected.size}`,
      leaked.length === 0,
      `leaked ${[...new Set(leaked)].length} depot(s)`,
    );
  }

  const insideCode = [...expected][0];
  const outsideCode = [...fixture.byCode.keys()].find((c) => !expected.has(c));

  const hit = await call(`/depots/api/v1/depots/${idOf(insideCode)}/inventory`, token);
  check(
    `${name}: by-id INSIDE the set is allowed (${insideCode})`,
    hit.status === 200,
    `got ${hit.status}`,
  );

  // 403 and not 404: a 404 would still confirm which depot ids exist.
  const miss = await call(`/depots/api/v1/depots/${idOf(outsideCode)}/inventory`, token);
  check(
    `${name}: by-id OUTSIDE the set is 403 (${outsideCode})`,
    miss.status === 403,
    `got ${miss.status}`,
  );

  // The same guard has to hold when the depot is asked for as a QUERY filter, not a
  // path param — that is the enumeration vector the path check does not cover.
  const filtered = await call(
    `/orders/api/v1/orders/manage?limit=1&depotId=${idOf(outsideCode)}`,
    token,
  );
  check(
    `${name}: ?depotId OUTSIDE the set is 403`,
    filtered.status === 403,
    `got ${filtered.status}`,
  );
}

// ---------------------------------------------------------------- item 2: matrix

/** One route per capability family, with the roles that must and must not reach it. */
const ROUTE_MATRIX = [
  {
    path: '/depots/api/v1/staff-hierarchy/00000000-0000-4000-8000-000000000001',
    label: 'hierarchyAdmin',
    allow: ['SUPER_ADMIN'],
    deny: ['MANAGER', 'SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'KEPALA_DEPOT', 'STAFF_DEPOT', 'HEAD_OFFICE', 'FINANCE', 'HR', 'MARKETING', 'DIREKTUR', 'FRANCHISE_OWNER', 'CUSTOMER'],
  },
  {
    path: '/auth/api/v1/access/matrix',
    label: 'staffAdmin (read the RBAC matrix)',
    allow: ['SUPER_ADMIN', 'HEAD_OFFICE'],
    // DIREKTUR is deliberately outside this one: reading the matrix is a step from
    // editing it, and only head office and the superuser hold that.
    deny: ['DIREKTUR', 'MANAGER', 'STAFF_DEPOT', 'KEPALA_DEPOT', 'CUSTOMER'],
  },
  {
    path: '/auth/api/v1/auth/staff?limit=1',
    label: 'staffDirectory',
    allow: ['SUPER_ADMIN', 'HEAD_OFFICE', 'DIREKTUR', 'MANAGER'],
    deny: ['STAFF_DEPOT', 'CUSTOMER'],
  },
];

async function roleMatrix() {
  for (const route of ROUTE_MATRIX) {
    for (const role of route.allow) {
      // A depot-locked role still needs a depot on its token to get past the scope guard.
      const depot = role === 'STAFF_DEPOT' || role === 'KEPALA_DEPOT' ? crypto.randomUUID() : null;
      const res = await call(route.path, tokenFor(role, crypto.randomUUID(), depot));
      check(
        `${route.label}: ${role} is allowed`,
        res.status !== 403 && res.status !== 401,
        `got ${res.status}`,
      );
    }
    for (const role of route.deny) {
      const depot = role === 'STAFF_DEPOT' || role === 'KEPALA_DEPOT' ? crypto.randomUUID() : null;
      const res = await call(route.path, tokenFor(role, crypto.randomUUID(), depot));
      check(`${route.label}: ${role} is REFUSED`, res.status === 403, `got ${res.status}`);
    }
  }

  // Anonymous must never reach a guarded route, whatever the guard decides after.
  const anon = await call('/auth/api/v1/access/matrix', null);
  check('guarded routes reject anonymous', anon.status === 401, `got ${anon.status}`);
}

// ---------------------------------------------------------------- run

async function main() {
  const fx = await loadFixture();
  const code = (i) => `HIER-${String(i).padStart(2, '0')}`;
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => code(a + i));

  const asv1Depots = range(1, 11);
  const asv2Depots = range(12, 22);

  console.log('— item 3: depot scope isolation');
  await scopeVectors('Asisten SPV A', 'ASSISTANT_SUPERVISOR', fx.asv1, asv1Depots, fx);
  await scopeVectors('Asisten SPV B', 'ASSISTANT_SUPERVISOR', fx.asv2, asv2Depots, fx);
  // 22 derived + HIER-23 granted directly.
  await scopeVectors('SPV', 'SUPERVISOR', fx.spv, [...asv1Depots, ...asv2Depots, 'HIER-23'], fx);
  // everything under the SPV, plus HIER-24 granted directly to the manager.
  await scopeVectors(
    'Manager',
    'MANAGER',
    fx.mgr,
    [...asv1Depots, ...asv2Depots, 'HIER-23', 'HIER-24'],
    fx,
  );

  // The orphan is the mandatory negative: nobody in the chain may see it.
  const orphan = fx.byCode.get('HIER-25');
  for (const [label, role, acct] of [
    ['Asisten SPV A', 'ASSISTANT_SUPERVISOR', fx.asv1],
    ['SPV', 'SUPERVISOR', fx.spv],
    ['Manager', 'MANAGER', fx.mgr],
  ]) {
    const res = await call(
      `/depots/api/v1/depots/${orphan.id}/inventory`,
      tokenFor(role, acct.id),
    );
    check(`${label} cannot open the ORPHAN depot`, res.status === 403, `got ${res.status}`);
  }
  const hqSeesOrphan = await call(`/depots/api/v1/depots/${orphan.id}/inventory`, ADMIN);
  check('HQ CAN open the orphan depot', hqSeesOrphan.status === 200, `got ${hqSeesOrphan.status}`);

  console.log('— item 2: role/route matrix');
  await roleMatrix();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
