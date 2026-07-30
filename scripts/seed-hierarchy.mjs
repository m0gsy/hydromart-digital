// Seed the depot hierarchy fixture F6 needs: the shape the business actually
// described, plus the negative cases that have never been exercised.
//
//   node scripts/seed-hierarchy.mjs
//
// Builds, on top of whatever scripts/seed.mjs already created:
//   - 25 depots (HIER-01 … HIER-25)
//   - 2 Asisten SPV, 11 depots each          -> tests the plain walk
//   - 1 SPV above both                        -> tests the 22-depot union
//   - 1 Manager above the SPV                 -> tests the two-hop walk
//   - depot 23 granted DIRECTLY to the SPV    -> tests derived UNION direct
//   - depot 24 granted DIRECTLY to the Manager
//   - depot 25 left ORPHAN, no assistant      -> the mandatory negative case:
//                                                visible to HQ and up, nobody else
//   - one login for each of the 13 roles
//
// Idempotent, like seed.mjs: everything is matched on a natural key (depot code /
// phone) and skipped when it is already there, so a half-finished run is safe to
// repeat. Drives the real gateway over HTTP — no DB access, just an up stack.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
import crypto from 'node:crypto';
import { fetchThrottled } from './lib/http.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: 'HS256', typ: 'JWT' };
  const body = {
    sub: crypto.randomUUID(),
    role: 'SUPER_ADMIN',
    phone: '+620000000000',
    iat: now,
    exp: now + 900,
  };
  const data = `${b64(head)}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const TOKEN = adminToken();

async function api(method, path, body) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function ok(res, step) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${step}: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

const rows = (payload) => (Array.isArray(payload) ? payload : (payload?.items ?? []));

// ---------------------------------------------------------------- data

/** One login per role. The three the hierarchy is built from come first. */
const ACCOUNTS = [
  { key: 'asv1', phone: '+6281199000001', role: 'ASSISTANT_SUPERVISOR', fullName: 'Asisten SPV Wilayah A' },
  { key: 'asv2', phone: '+6281199000002', role: 'ASSISTANT_SUPERVISOR', fullName: 'Asisten SPV Wilayah B' },
  { key: 'spv', phone: '+6281199000003', role: 'SUPERVISOR', fullName: 'SPV Jabodetabek' },
  { key: 'mgr', phone: '+6281199000004', role: 'MANAGER', fullName: 'Manager Regional' },
  { key: 'direktur', phone: '+6281199000005', role: 'DIREKTUR', fullName: 'Direktur Operasional' },
  { key: 'ho', phone: '+6281199000006', role: 'HEAD_OFFICE', fullName: 'Head Office' },
  { key: 'finance', phone: '+6281199000007', role: 'FINANCE', fullName: 'Finance' },
  { key: 'marketing', phone: '+6281199000008', role: 'MARKETING', fullName: 'Marketing' },
  { key: 'hr', phone: '+6281199000009', role: 'HR', fullName: 'HR' },
  { key: 'superadmin', phone: '+6281199000010', role: 'SUPER_ADMIN', fullName: 'Super Admin E2E' },
  { key: 'owner', phone: '+6281199000011', role: 'FRANCHISE_OWNER', fullName: 'Pemilik Waralaba' },
  // Both depot-LOCKED roles need a depot or inviteStaff refuses them (StaffDepotRequiredError).
  { key: 'kepala', phone: '+6281199000012', role: 'KEPALA_DEPOT', fullName: 'Kepala Depot HIER-01', depot: 'HIER-01' },
  { key: 'staf', phone: '+6281199000013', role: 'STAFF_DEPOT', fullName: 'Kurir HIER-01', depot: 'HIER-01' },
];

const DEPOT_COUNT = 25;
const ASV1_DEPOTS = 11; // HIER-01 … HIER-11
const ASV2_DEPOTS = 11; // HIER-12 … HIER-22
const DIRECT_TO_SPV = 'HIER-23';
const DIRECT_TO_MGR = 'HIER-24';
const ORPHAN = 'HIER-25';

const code = (i) => `HIER-${String(i).padStart(2, '0')}`;

/** Spread around Jakarta so `nearby` has something plausible to sort. */
function depotBody(i) {
  return {
    code: code(i),
    name: `Depot Hierarki ${i}`,
    ownershipType: 'HKP',
    address: `Jl. Hierarki No. ${i}`,
    city: 'Jakarta',
    province: 'DKI Jakarta',
    lat: -6.2 + i * 0.01,
    lng: 106.8 + i * 0.01,
    serviceRadiusKm: 7,
    deliveryFee: 1000,
    minOrderAmount: 15000,
  };
}

// ---------------------------------------------------------------- run

// The manage list caps `limit` at 100 and this box already holds more depots than that once the
// 25 fixture ones land, so walk the pages instead of asking for everything at once.
async function listDepots() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const batch = rows(
      ok(await api('GET', `/depots/api/v1/depots/manage?limit=100&page=${page}`), 'list depots'),
    );
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function ensureDepots() {
  const existing = new Map((await listDepots()).map((d) => [d.code, d.id]));
  const ids = {};
  let created = 0;
  for (let i = 1; i <= DEPOT_COUNT; i += 1) {
    const c = code(i);
    if (existing.has(c)) {
      ids[c] = existing.get(c);
      continue;
    }
    ids[c] = ok(await api('POST', '/depots/api/v1/depots', depotBody(i)), `create ${c}`).id;
    created += 1;
  }
  console.log(`depots: ${created} created, ${DEPOT_COUNT - created} already there`);
  return ids;
}

async function ensureAccounts(depotIds) {
  const ids = {};
  for (const a of ACCOUNTS) {
    const body = { phone: a.phone, role: a.role, fullName: a.fullName };
    if (a.depot) body.depotId = depotIds[a.depot];
    // inviteStaff promotes an existing phone rather than failing, so this is the
    // idempotent path for both a first run and a re-run.
    ids[a.key] = ok(await api('POST', '/auth/api/v1/auth/staff/invite', body), `invite ${a.key}`).id;
  }
  console.log(`accounts: ${ACCOUNTS.length} in place, one per role`);
  return ids;
}

async function buildHierarchy(depotIds, accountIds) {
  const put = (path, body, step) => api('PUT', path, body).then((r) => ok(r, step));

  for (let i = 1; i <= ASV1_DEPOTS; i += 1) {
    await put(
      `/depots/api/v1/staff-hierarchy/depots/${depotIds[code(i)]}/assistant`,
      { assistantSupervisorId: accountIds.asv1 },
      `assign ${code(i)} -> asv1`,
    );
  }
  for (let i = ASV1_DEPOTS + 1; i <= ASV1_DEPOTS + ASV2_DEPOTS; i += 1) {
    await put(
      `/depots/api/v1/staff-hierarchy/depots/${depotIds[code(i)]}/assistant`,
      { assistantSupervisorId: accountIds.asv2 },
      `assign ${code(i)} -> asv2`,
    );
  }

  await put(
    `/depots/api/v1/staff-hierarchy/${accountIds.asv1}/superior`,
    { superiorId: accountIds.spv },
    'asv1 -> spv',
  );
  await put(
    `/depots/api/v1/staff-hierarchy/${accountIds.asv2}/superior`,
    { superiorId: accountIds.spv },
    'asv2 -> spv',
  );
  await put(
    `/depots/api/v1/staff-hierarchy/${accountIds.spv}/superior`,
    { superiorId: accountIds.mgr },
    'spv -> mgr',
  );

  // Direct grants: the reason scope is derived UNION direct rather than derived alone.
  await put(
    `/depots/api/v1/staff-hierarchy/${accountIds.spv}/depots/${depotIds[DIRECT_TO_SPV]}`,
    {},
    `${DIRECT_TO_SPV} -> spv (direct)`,
  );
  await put(
    `/depots/api/v1/staff-hierarchy/${accountIds.mgr}/depots/${depotIds[DIRECT_TO_MGR]}`,
    {},
    `${DIRECT_TO_MGR} -> mgr (direct)`,
  );

  // ORPHAN is deliberately left alone. Nothing to do — that IS the fixture.
  console.log(`hierarchy: 22 supervised, 2 direct grants, ${ORPHAN} left orphan on purpose`);
}

/** Read the scope back through the same endpoint the guards use, and assert the shape. */
async function verify(depotIds, accountIds) {
  const scope = async (id, role) =>
    ok(
      await api('GET', `/depots/api/v1/staff-hierarchy/${id}?role=${role}`),
      `describe ${role}`,
    );

  const asv1 = await scope(accountIds.asv1, 'ASSISTANT_SUPERVISOR');
  const spv = await scope(accountIds.spv, 'SUPERVISOR');
  const mgr = await scope(accountIds.mgr, 'MANAGER');

  const checks = [
    [`asv1 supervises ${ASV1_DEPOTS} depots`, asv1.assistantDepotIds.length === ASV1_DEPOTS],
    ['spv has 2 direct reports', spv.subordinateIds.length === 2],
    ['spv holds 1 direct depot grant', spv.directDepotIds.length === 1],
    ['mgr has 1 direct report', mgr.subordinateIds.length === 1],
    ['mgr holds 1 direct depot grant', mgr.directDepotIds.length === 1],
    [
      `${ORPHAN} belongs to nobody`,
      !spv.assistantDepotIds.includes(depotIds[ORPHAN]) &&
        !spv.directDepotIds.includes(depotIds[ORPHAN]),
    ],
  ];

  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`);
    if (!pass) failed += 1;
  }
  return failed;
}

async function main() {
  const depotIds = await ensureDepots();
  const accountIds = await ensureAccounts(depotIds);
  await buildHierarchy(depotIds, accountIds);
  const failed = await verify(depotIds, accountIds);
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed — the fixture is NOT ready for F6.`);
    process.exit(1);
  }
  console.log('\nHierarchy fixture ready.');
  console.log(`  SPV should see ${ASV1_DEPOTS + ASV2_DEPOTS + 1} depots (22 derived + 1 direct)`);
  console.log(`  Manager should see ${ASV1_DEPOTS + ASV2_DEPOTS + 2} (the SPV's, plus its own direct)`);
  console.log(`  ${ORPHAN} must appear for HQ and up ONLY`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
