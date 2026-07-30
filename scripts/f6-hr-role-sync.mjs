// F6 item 7: the HR paths that only exist ACROSS services, so no unit suite can
// cover them however green it is.
//
//   node scripts/f6-hr-role-sync.mjs
//
// Three things F4 built that span hr-service and auth-service:
//
//   1. Editing an employee's jabatan re-roles their LOGIN. This is the trap F4
//      closed: role used to be written only on import, so a promotion changed the
//      title and left the person with their old access.
//   2. The re-role is bounded by HR_MANAGED_ROLES. An employee form must not be a
//      path to a HEAD_OFFICE or SUPER_ADMIN account.
//   3. An employee above depot level can exist at all — depotId is nullable now —
//      and does NOT then show up in every depot's roster.
//
// Creates one throwaway employee and leaves it INACTIVE rather than deleting it, so
// a failed run is inspectable. Re-running makes a new one.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
import crypto from 'node:crypto';
import { fetchThrottled, listAllPages } from './lib/http.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(role, depotId = null) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: crypto.randomUUID(), role, phone: '+620000000000', depotId, iat: now, exp: now + 1800 })}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}

const ADMIN = tokenFor('SUPER_ADMIN');

async function api(method, path, body, token = ADMIN) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
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

// hr-service answers { rows, total }; every other service answers { items, total }. Reading only
// `items` here made the depot-roster check pass against an empty array, which proves nothing.
const rows = (b) => (Array.isArray(b) ? b : (b?.items ?? b?.rows ?? []));
const stamp = Date.now().toString().slice(-7);

async function main() {
  const depots = rows((await api('GET', '/depots/api/v1/depots/manage?limit=5')).body);
  if (depots.length === 0) {
    console.error('No depots. Run scripts/seed.mjs first.');
    process.exit(1);
  }
  const depotId = depots[0].id;
  const phone = `+62899${stamp}`;

  // --- 1. create an employee WITH a login role, then promote them ----------------
  const created = await api('POST', '/hr/api/v1/employees', {
    fullName: `F6 Sync ${stamp}`,
    phone,
    depotId,
    position: 'Asisten SPV',
    role: 'ASSISTANT_SUPERVISOR',
    employmentStatus: 'PROBATION',
    joinDate: '2026-01-01',
    salaryType: 'MONTHLY',
    monthlyRate: 7_000_000,
  });
  if (created.status < 200 || created.status >= 300) {
    console.error(`create employee failed: ${created.status} ${JSON.stringify(created.body)}`);
    process.exit(1);
  }
  const employee = created.body;
  check('employee created carrying a jabatan', employee.role === 'ASSISTANT_SUPERVISOR', `role=${employee.role}`);

  // The employee form does NOT provision a login (only the import does), so link the
  // account first — that is the state a promotion actually happens in.
  const invited = await api('POST', '/auth/api/v1/auth/staff/invite', {
    phone,
    role: 'ASSISTANT_SUPERVISOR',
    fullName: `F6 Sync ${stamp}`,
    depotId,
  });
  const authSubjectId = invited.body?.id;
  check('login account exists for the employee', Boolean(authSubjectId), `status ${invited.status}`);
  await api('PATCH', `/hr/api/v1/employees/${employee.id}`, { authSubjectId });

  // --- 2. the promotion must move the LOGIN, not just the title -----------------
  const promoted = await api('PATCH', `/hr/api/v1/employees/${employee.id}`, {
    role: 'SUPERVISOR',
    position: 'SPV Wilayah',
  });
  check('promotion accepted', promoted.status === 200, `got ${promoted.status}`);
  check('employee record shows the new jabatan', promoted.body?.role === 'SUPERVISOR', `role=${promoted.body?.role}`);

  const account = (
    await listAllPages(async (page, size) =>
      rows((await api('GET', `/auth/api/v1/auth/staff?limit=${size}&page=${page}`)).body),
    )
  ).find((s) => s.id === authSubjectId);
  check(
    'THE LOGIN followed the promotion (the F4 trap)',
    account?.role === 'SUPERVISOR',
    `login role=${account?.role}`,
  );

  // --- 3. HR_MANAGED_ROLES is the ceiling ---------------------------------------
  for (const role of ['SUPER_ADMIN', 'HEAD_OFFICE', 'FINANCE', 'DIREKTUR']) {
    const res = await api('PATCH', `/hr/api/v1/employees/${employee.id}`, { role });
    check(`an employee form cannot mint ${role}`, res.status === 400, `got ${res.status}`);
  }

  // --- 4. an employee above depot level ----------------------------------------
  const networkWide = await api('POST', '/hr/api/v1/employees', {
    fullName: `F6 Network ${stamp}`,
    phone: `+62898${stamp}`,
    position: 'Manager Regional',
    role: 'MANAGER',
    employmentStatus: 'PERMANENT',
    joinDate: '2026-01-01',
    salaryType: 'MONTHLY',
    monthlyRate: 12_000_000,
  });
  check('an employee with NO depot can be created', networkWide.status === 201, `got ${networkWide.status}`);
  check('their depot is null, not a sentinel', networkWide.body?.depotId === null, `depotId=${networkWide.body?.depotId}`);

  // ...and must not then appear in every depot's roster.
  // hr paginates on pageSize, not limit — asking for `limit` silently returns the first 20.
  const depotRoster = await listAllPages(async (page, size) =>
    rows((await api('GET', `/hr/api/v1/employees?depotId=${depotId}&pageSize=${size}&page=${page}`)).body),
  );
  check(
    'the depot-less employee is absent from a depot roster',
    !depotRoster.some((e) => e.id === networkWide.body?.id),
  );

  // --- 5. DEPOT_MANAGER is gone from the status enum ----------------------------
  const oldStatus = await api('PATCH', `/hr/api/v1/employees/${employee.id}`, {
    employmentStatus: 'DEPOT_MANAGER',
  });
  check('DEPOT_MANAGER is rejected as an employment status', oldStatus.status === 400, `got ${oldStatus.status}`);

  // Leave the fixtures inactive rather than deleting them, so a failure is inspectable.
  for (const id of [employee.id, networkWide.body?.id].filter(Boolean)) {
    await api('PATCH', `/hr/api/v1/employees/${id}`, { status: 'INACTIVE' });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
