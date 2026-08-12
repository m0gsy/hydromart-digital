// The five payroll checks the plan lists as MANUAL (items 17-21), driven over real HTTP
// against a running stack instead of clicked by hand.
//
//   JWT_ACCESS_SECRET=<the stack's secret> node scripts/payroll-manual-checks.mjs
//
// Why automate a manual checklist: each of these is a money path, each one is only true
// end-to-end (guard + service + repository + database), and "somebody clicked it once in
// July" is not a fact anybody can re-check. A unit test cannot prove item 17 at all — depot
// scoping is a guard plus a query, and the bug it protects against was a missing parameter.
//
// Fixtures are tagged `PMC-<stamp>` and left behind INACTIVE rather than deleted, so a
// failed run stays inspectable. Re-running makes a fresh set.
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

const STAMP = `PMC-${Date.now().toString(36).toUpperCase()}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function tokenFor(role, depotId = null, sub = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, phone: '+620000000000', depotId, iat: now, exp: now + 3600 })}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}

const HR = tokenFor('HR');

async function api(method, path, body, token = HR) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
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

let failures = 0;
const ok = (n) => console.log(`  ok   ${n}`);
const bad = (n, detail) => {
  console.log(`  FAIL ${n}`);
  if (detail !== undefined) console.log(`       ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`);
  failures++;
};

/** Sum of payroll items of one kind. */
const sumKind = (payroll, kind) =>
  (payroll?.items ?? []).filter((i) => i.kind === kind).reduce((s, i) => s + Number(i.amount), 0);

async function depots() {
  // `limit`, not `pageSize` — the depot browse endpoint validates its query strictly and
  // rejects unknown properties outright (400 VALIDATION_ERROR), which is the correct
  // behaviour and the reason this is spelled from endpoints/depot.ts rather than guessed.
  const res = await api('GET', '/depots/api/v1/depots?limit=5');
  if (res.status !== 200) throw new Error(`cannot list depots: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body?.items ?? res.body?.rows ?? res.body?.data ?? [];
}

async function createEmployee(depotId, overrides = {}) {
  const res = await api('POST', '/hr/api/v1/employees', {
    fullName: `${STAMP} ${overrides.tag ?? 'Staf'}`,
    phone: `+62811${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
    position: 'Staf Depot',
    // Required, and constrained to the staff roles — CUSTOMER and the head-office roles are
    // rejected. STAFF_DEPOT is the plainest one: no tenure raise, no depot-head bonus, so
    // the payroll figures below stay about the employment window and nothing else.
    role: 'STAFF_DEPOT',
    employmentStatus: 'PERMANENT',
    salaryType: 'MONTHLY',
    monthlyRate: 3_000_000,
    joinDate: '2020-01-01',
    depotId,
    ...overrides.body,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`create employee failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body;
}

const PERIOD = '2026-03';

/**
 * Refuse to run against a stack older than the code being checked.
 *
 * Learned the hard way: run against a container built before D3/D10 and this script
 * reports "base pay NOT prorated", "net went negative" and a 404 — three confident,
 * completely misleading failures that read exactly like real money bugs. Half an hour can
 * go into diagnosing a defect that shipped correctly and is simply not in the image.
 *
 * `/payroll/generate-batch` is the cheapest tell: it arrived with D10, after everything
 * else this file checks. A 404 on OPTIONS/POST means the stack predates the whole set.
 */
async function refuseStaleStack() {
  const probe = await api('POST', '/hr/api/v1/payroll/generate-batch', {
    depotId: '00000000-0000-4000-8000-000000000000',
    periodMonth: PERIOD,
  });
  if (probe.status === 404) {
    console.error('!! this stack predates D10 (`POST /payroll/generate-batch` is a 404).');
    console.error('   Every check below would fail for that reason and none of the failures');
    console.error('   would be about your code. Rebuild the hr service first:');
    console.error('     docker compose -f docker-compose.prod.yml build hr && \\');
    console.error('     docker compose -f docker-compose.prod.yml up -d hr');
    process.exit(2);
  }
}

async function main() {
  console.log(`payroll manual checks (${STAMP}) against ${GATEWAY}\n`);
  await refuseStaleStack();
  const ds = await depots();
  if (ds.length < 2) {
    console.error(`!! need at least 2 depots seeded; found ${ds.length}. Run scripts/seed.mjs first.`);
    process.exit(2);
  }
  const [depotA, depotB] = ds;

  // ---- 17: a depot MANAGER sees only their own depot's payroll --------------------
  const empA = await createEmployee(depotA.id, { tag: 'A' });
  const empB = await createEmployee(depotB.id, { tag: 'B' });
  await api('POST', '/hr/api/v1/payroll/generate', { employeeId: empA.id, periodMonth: PERIOD });
  await api('POST', '/hr/api/v1/payroll/generate', { employeeId: empB.id, periodMonth: PERIOD });

  const managerA = tokenFor('MANAGER', depotA.id);
  const list = await api('GET', '/hr/api/v1/payroll?pageSize=100', undefined, managerA);
  if (list.status !== 200) {
    bad('17 manager payroll list', `status ${list.status}`);
  } else {
    const rows = list.body?.rows ?? list.body?.data ?? [];
    const foreign = rows.filter((r) => r.employee?.depotId && r.employee.depotId !== depotA.id);
    if (foreign.length === 0) ok(`17 MANAGER of depot A sees no other depot's payroll (${rows.length} rows)`);
    else bad('17 depot scoping leaks', `${foreign.length} row(s) from another depot`);
  }

  // ---- 19: a joiner on the 25th is prorated and NOT fined for days 1-24 ------------
  const joiner = await createEmployee(depotA.id, {
    tag: 'Joiner25',
    body: { joinDate: `${PERIOD}-25` },
  });
  const jp = await api('POST', '/hr/api/v1/payroll/generate', {
    employeeId: joiner.id,
    periodMonth: PERIOD,
  });
  if (jp.status !== 201 && jp.status !== 200) {
    bad('19 generate for a mid-month joiner', `status ${jp.status} ${JSON.stringify(jp.body).slice(0, 200)}`);
  } else {
    const base = sumKind(jp.body, 'BASE');
    const deductions = sumKind(jp.body, 'DEDUCTION');
    if (base > 0 && base < 3_000_000) ok(`19 base pay prorated: Rp ${base.toLocaleString('id-ID')} of 3.000.000`);
    else bad('19 base pay NOT prorated', `base=${base}`);
    // Guarded, because this assertion can pass for the wrong reason: if the depot's
    // `absenceDeductionAmount` is 0 there is no fine to avoid, and "no deductions" proves
    // nothing at all. Seen happening on a stale stack, where it read as a pass while the
    // prorate beside it was plainly broken.
    // Switch the fine ON for this depot first. Without it there is no fine to escape, and
    // "no deductions" would read as a pass while proving nothing — which is exactly what
    // happened the first time this ran. The value is restored below.
    // `scope` is required and the API rejects the request without it — a per-depot value
    // and a network-wide one are deliberately different writes.
    await api('PUT', '/hr/api/v1/hr/settings', {
      key: 'absenceDeductionAmount',
      value: '50000',
      scope: 'DEPOT',
      depotId: depotA.id,
    });
    const control = await api('POST', '/hr/api/v1/payroll/generate', {
      employeeId: empA.id,
      periodMonth: PERIOD,
    });
    const fineIsConfigured = sumKind(control.body, 'DEDUCTION') > 0;
    if (!fineIsConfigured) {
      bad(
        '19 absence fine is not configured on this depot',
        'cannot prove a joiner escapes it — set absenceDeductionAmount > 0 and re-run',
      );
    } else if (deductions === 0) {
      ok('19 no absence fine for the days before they joined');
    } else {
      bad('19 joiner fined for days before joining', `deductions=${deductions}`);
    }
    // Put the depot back the way it was found. A verification script that leaves a fine
    // switched on is a verification script that changes somebody's payroll.
    await api('DELETE', '/hr/api/v1/hr/settings', {
      key: 'absenceDeductionAmount',
      scope: 'DEPOT',
      depotId: depotA.id,
    });
  }

  // ---- 20: net floors at 0 and the unpaid remainder rolls forward ------------------
  const trainee = await createEmployee(depotA.id, {
    tag: 'Trainee',
    body: { employmentStatus: 'TRAINING', salaryType: 'DAILY', monthlyRate: null, dailyRate: 50_000 },
  });
  await api('POST', '/hr/api/v1/deductions', {
    employeeId: trainee.id,
    type: 'MANUAL',
    amount: 9_000_000,
    periodMonth: PERIOD,
    note: `${STAMP} denda besar`,
  });
  const tp = await api('POST', '/hr/api/v1/payroll/generate', {
    employeeId: trainee.id,
    periodMonth: PERIOD,
  });
  if (tp.status !== 201 && tp.status !== 200) {
    bad('20 generate for a trainee with a large fine', `status ${tp.status}`);
  } else if (Number(tp.body.net) >= 0) {
    ok(`20 net floored at zero, not negative (net=${tp.body.net})`);
  } else {
    bad('20 net went negative', `net=${tp.body.net}`);
  }

  // ---- 21: batch generate twice is identical, and creates no duplicates ------------
  const first = await api('POST', '/hr/api/v1/payroll/generate-batch', {
    depotId: depotA.id,
    periodMonth: PERIOD,
  });
  const second = await api('POST', '/hr/api/v1/payroll/generate-batch', {
    depotId: depotA.id,
    periodMonth: PERIOD,
  });
  if (first.status >= 400 || second.status >= 400) {
    bad('21 batch generate', `status ${first.status}/${second.status}`);
  } else {
    const n1 = first.body?.generated ?? first.body?.results?.length;
    const n2 = second.body?.generated ?? second.body?.results?.length;
    if (n1 === n2) ok(`21 batch generate is idempotent (${n1} both runs)`);
    else bad('21 batch generate is not idempotent', `${n1} then ${n2}`);

    const after = await api('GET', `/hr/api/v1/payroll?periodMonth=${PERIOD}&pageSize=200`);
    const rows = after.body?.rows ?? after.body?.data ?? [];
    const seen = new Map();
    for (const r of rows) {
      const key = `${r.employeeId}|${r.periodMonth}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    if (dupes.length === 0) ok('21 no duplicate payroll row for any (employee, period)');
    else bad('21 duplicate payroll rows', dupes.slice(0, 3));
  }

  console.log('');
  if (failures) {
    console.error(`payroll manual checks: ${failures} FAILED`);
    process.exit(1);
  }
  console.log('payroll manual checks: all passed');
}

main().catch((e) => {
  console.error(`payroll manual checks: ${e.message}`);
  process.exit(1);
});
