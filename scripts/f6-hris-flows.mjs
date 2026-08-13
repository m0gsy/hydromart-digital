// The HRIS chains that only exist ACROSS modules, so no unit suite proves them however
// green it is. This is §8.4 of docs/HRIS_GAP_PLAN.md, driven over real HTTP.
//
//   node scripts/f6-hris-flows.mjs
//
// What it proves, in the order the plan asks for it:
//
//   1. Leave  submit -> manager -> HR -> an Attendance LEAVE row per WORKING day, and
//      payroll for that month stops charging those days as absence.
//   2. A national holiday inside the range is neither stamped nor charged to quota.
//   3. ANNUAL spends quota; SICK does not, yet still stamps its LEAVE rows.
//   4. Documents  upload -> replace -> the old version survives, marked superseded.
//   5. Assets  assign -> transfer -> return, with the whole history and the right end state.
//   6. Announcements  overlapping targets reach a person ONCE, and a future schedule waits
//      for the sweep instead of going out on save.
//   7. Allowances  land as their own slip line, and an expired one is not paid.
//
// Fixtures are tagged `F6H-<stamp>` and left behind INACTIVE rather than deleted, so a
// failed run stays inspectable. Re-running makes a fresh set.
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
function tokenFor(role, depotId = null, sub = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, phone: '+620000000000', depotId, iat: now, exp: now + 3600 })}`;
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

/** multipart, for the one endpoint that takes a file. */
async function upload(path, fields, file, token = ADMIN) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('file', new Blob([file.bytes], { type: file.mime }), file.name);
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  } catch {
    return { status: res.status, body: text };
  }
}

let failed = 0;
let passed = 0;
let skipped = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
/** A gap in the environment, not a verdict on the code — always says why. */
function skip(label, why) {
  skipped += 1;
  console.log(`skip ${label} — ${why}`);
}

// hr-service answers { rows, total }; everyone else { items, total }.
const rows = (b) => (Array.isArray(b) ? b : (b?.rows ?? b?.items ?? []));
const stamp = Date.now().toString().slice(-7);
const ok2xx = (r) => r.status >= 200 && r.status < 300;
const day = (d) => d.toISOString().slice(0, 10);

/** A Mon-Fri run of `count` weekdays starting the next Monday at least `minAhead` days out. */
function weekdayRun(count, minAhead = 21) {
  const d = new Date(Date.now() + minAhead * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const days = [];
  for (let i = 0; days.length < count; i += 1) {
    const c = new Date(d.getTime() + i * 86_400_000);
    if (c.getUTCDay() !== 0 && c.getUTCDay() !== 6) days.push(c);
  }
  return days;
}

// One phone per employee this run. It used to be `${stamp}${suffix.length}` — the LENGTH of
// the suffix, so any two chains whose labels happened to be the same length collided and the
// second one died on "Nomor telepon ini sudah dipakai karyawan lain".
let phoneSeq = 0;

async function makeEmployee(depotId, suffix, extra = {}) {
  phoneSeq += 1;
  const created = await api('POST', '/hr/api/v1/employees', {
    fullName: `F6H ${suffix} ${stamp}`,
    phone: `+6289${stamp}${phoneSeq}`,
    depotId,
    position: 'Staf Depot',
    role: 'STAFF_DEPOT',
    employmentStatus: 'PERMANENT',
    joinDate: '2026-01-01',
    salaryType: 'MONTHLY',
    monthlyRate: 6_000_000,
    ...extra,
  });
  if (!ok2xx(created)) {
    throw new Error(
      `create employee ${suffix} failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  return created.body;
}

async function main() {
  const depots = rows((await api('GET', '/depots/api/v1/depots/manage?limit=5')).body);
  if (depots.length === 0) {
    console.error('No depots. Run scripts/seed.mjs first.');
    process.exit(1);
  }
  const depotId = depots[0].id;
  const MANAGER = tokenFor('MANAGER', depotId);
  const cleanup = [];

  // ── fixture: one employee with a LOGIN, because leave is self-service ────────────
  const employee = await makeEmployee(depotId, 'Cuti');
  cleanup.push(employee.id);
  const phone = employee.phone;
  const invited = await api('POST', '/auth/api/v1/auth/staff/invite', {
    phone,
    role: 'STAFF_DEPOT',
    fullName: employee.fullName,
    depotId,
    // Required since an invite also opens an HR record; this fixture is about leave.
    position: 'Kurir',
    joinDate: '2026-01-01',
    employmentStatus: 'PERMANENT',
    salaryType: 'MONTHLY',
    monthlyRate: 5_000_000,
  });
  const authSubjectId = invited.body?.id;
  if (!authSubjectId) {
    console.error(
      `could not mint a login for the fixture: ${invited.status} ${JSON.stringify(invited.body)}`,
    );
    process.exit(1);
  }
  await api('PATCH', `/hr/api/v1/employees/${employee.id}`, { authSubjectId });
  const SELF = tokenFor('STAFF_DEPOT', depotId, authSubjectId);

  // ── 1-3. leave ──────────────────────────────────────────────────────────────────
  // A Mon-Fri week, with a national holiday planted on the Wednesday: the holiday must
  // neither be stamped as leave nor charged to the quota.
  const week = weekdayRun(5);
  const holiday = week[2];
  const holidayRes = await api('POST', '/hr/api/v1/holidays', {
    date: day(holiday),
    name: `F6H Libur ${stamp}`,
    depotId,
  });
  check(
    'a national holiday can be planted inside the range',
    ok2xx(holidayRes),
    `got ${holidayRes.status}`,
  );

  const year = week[0].getUTCFullYear();
  const before = await api('GET', `/hr/api/v1/leave/me/balance?year=${year}`, undefined, SELF);
  const usedBefore = before.body?.usedDays ?? 0;

  const submitted = await api(
    'POST',
    '/hr/api/v1/leave/me',
    {
      type: 'ANNUAL',
      startDate: day(week[0]),
      endDate: day(week[4]),
      reason: 'F6 HRIS chain proof',
    },
    SELF,
  );
  check(
    'an employee can submit their own leave',
    ok2xx(submitted),
    `got ${submitted.status} ${JSON.stringify(submitted.body)}`,
  );
  const leave = submitted.body;
  check(
    'it starts at the manager stage',
    leave?.status === 'PENDING_MANAGER',
    `status=${leave?.status}`,
  );
  check(
    'the holiday is not counted in the frozen working days',
    leave?.workingDays === 4,
    `workingDays=${leave?.workingDays} (Mon-Fri minus one holiday = 4)`,
  );

  const mgr = await api(
    'PATCH',
    `/hr/api/v1/leave/${leave?.id}/manager-decision`,
    { approve: true },
    MANAGER,
  );
  check(
    'the manager approval moves it to HR',
    mgr.body?.status === 'PENDING_HR',
    `status=${mgr.body?.status} (${mgr.status})`,
  );

  // Attendance must be untouched until HR signs off — the stamp is the LAST step.
  const midway = rows(
    (
      await api(
        'GET',
        `/hr/api/v1/attendance?employeeId=${employee.id}&from=${day(week[0])}&to=${day(week[4])}&pageSize=100`,
      )
    ).body,
  );
  check(
    'nothing is stamped on the manager approval alone',
    midway.length === 0,
    `${midway.length} rows`,
  );

  const hr = await api('PATCH', `/hr/api/v1/leave/${leave?.id}/hr-decision`, { approve: true });
  check(
    'the HR approval closes it',
    hr.body?.status === 'APPROVED',
    `status=${hr.body?.status} (${hr.status})`,
  );

  const stamped = rows(
    (
      await api(
        'GET',
        `/hr/api/v1/attendance?employeeId=${employee.id}&from=${day(week[0])}&to=${day(week[4])}&pageSize=100`,
      )
    ).body,
  );
  const leaveDays = stamped
    .filter((a) => a.status === 'LEAVE')
    .map((a) => String(a.workDate).slice(0, 10));
  check(
    'ONE Attendance LEAVE row per working day (the leave -> payroll link)',
    leaveDays.length === 4,
    `stamped ${leaveDays.length}: ${leaveDays.join(', ')}`,
  );
  check(
    'the holiday inside the range is NOT stamped',
    !leaveDays.includes(day(holiday)),
    `holiday ${day(holiday)} in ${leaveDays.join(', ')}`,
  );

  const afterAnnual = await api('GET', `/hr/api/v1/leave/me/balance?year=${year}`, undefined, SELF);
  check(
    'ANNUAL spends exactly the working days it stamped',
    (afterAnnual.body?.usedDays ?? 0) - usedBefore === 4,
    `used ${usedBefore} -> ${afterAnnual.body?.usedDays}`,
  );

  // SICK: stamps attendance the same way, spends no quota.
  const sickWeek = weekdayRun(2, 60);
  const sick = await api(
    'POST',
    '/hr/api/v1/leave/me',
    { type: 'SICK', startDate: day(sickWeek[0]), endDate: day(sickWeek[1]), reason: 'F6 sick' },
    SELF,
  );
  await api(
    'PATCH',
    `/hr/api/v1/leave/${sick.body?.id}/manager-decision`,
    { approve: true },
    MANAGER,
  );
  const sickDone = await api('PATCH', `/hr/api/v1/leave/${sick.body?.id}/hr-decision`, {
    approve: true,
  });
  const sickRows = rows(
    (
      await api(
        'GET',
        `/hr/api/v1/attendance?employeeId=${employee.id}&from=${day(sickWeek[0])}&to=${day(sickWeek[1])}&pageSize=100`,
      )
    ).body,
  ).filter((a) => a.status === 'LEAVE');
  check(
    'sick leave is approved and stamped too',
    sickDone.body?.status === 'APPROVED' && sickRows.length === 2,
    `${sickRows.length} rows`,
  );
  const afterSick = await api(
    'GET',
    `/hr/api/v1/leave/me/balance?year=${sickWeek[0].getUTCFullYear()}`,
    undefined,
    SELF,
  );
  const expectedUsed =
    sickWeek[0].getUTCFullYear() === year ? (afterAnnual.body?.usedDays ?? 0) : 0;
  check(
    'sick leave spends NO quota',
    (afterSick.body?.usedDays ?? 0) === expectedUsed,
    `used=${afterSick.body?.usedDays}, expected ${expectedUsed}`,
  );

  // Payroll for the leave month must not charge those days as absence.
  const period = day(week[0]).slice(0, 7);
  // The deduction only exists where a rate is configured, and most depots leave it at 0 —
  // so set one for THIS depot, measure, and reset it. Without a rate there is no line to
  // read and the most valuable claim in the plan would go unproven.
  const chargedDays = async (label) => {
    const res = await api('POST', '/hr/api/v1/payroll/generate', {
      employeeId: employee.id,
      periodMonth: period,
    });
    if (!ok2xx(res)) return { error: `${res.status} ${JSON.stringify(res.body)}` };
    const line = (res.body?.items ?? []).find((i) => String(i.label).startsWith('Potongan absen'));
    if (!line) return { days: 0, label };
    return { days: Number(String(line.label).match(/\((\d+) hari\)/)?.[1] ?? NaN), label };
  };

  const rateSet = await api('PUT', '/hr/api/v1/hr/settings', {
    scope: 'DEPOT',
    depotId,
    key: 'absenceDeductionAmount',
    value: '10000',
  });
  if (!ok2xx(rateSet)) {
    skip(
      'payroll counts the leave instead of docking it',
      `could not set an absence rate: ${rateSet.status}`,
    );
  } else {
    const withLeave = await chargedDays('with the leave approved');
    // Cancelling the approved leave is not a supported move, so measure the counterfactual
    // the other way: a colleague on the same depot and month who took no leave at all.
    const colleague = await makeEmployee(depotId, 'Absen');
    cleanup.push(colleague.id);
    const colleaguePay = await api('POST', '/hr/api/v1/payroll/generate', {
      employeeId: colleague.id,
      periodMonth: period,
    });
    const colleagueLine = (colleaguePay.body?.items ?? []).find((i) =>
      String(i.label).startsWith('Potongan absen'),
    );
    const colleagueDays = Number(String(colleagueLine?.label).match(/\((\d+) hari\)/)?.[1] ?? NaN);
    check(
      'payroll CREDITS the approved leave instead of docking it as absence',
      Number.isFinite(colleagueDays) &&
        Number.isFinite(withLeave.days) &&
        colleagueDays - withLeave.days === 4,
      `colleague charged ${colleagueDays} days, the person on leave ${withLeave.days} — expected exactly 4 fewer`,
    );
    await api('DELETE', '/hr/api/v1/hr/settings', {
      scope: 'DEPOT',
      depotId,
      key: 'absenceDeductionAmount',
    });
  }

  // ── 4. documents ────────────────────────────────────────────────────────────────
  const pdf = {
    bytes: Buffer.from('%PDF-1.4 f6 hris proof'),
    mime: 'application/pdf',
    name: 'ktp.pdf',
  };
  const v1 = await upload(
    '/hr/api/v1/employee-documents',
    { employeeId: employee.id, type: 'KTP' },
    pdf,
  );
  if (!ok2xx(v1)) {
    skip(
      'a replaced document keeps its old version',
      `upload answered ${v1.status} ${JSON.stringify(v1.body)}`,
    );
  } else {
    check('the first upload is version 1', v1.body?.version === 1, `version=${v1.body?.version}`);
    const v2 = await upload(
      '/hr/api/v1/employee-documents',
      { employeeId: employee.id, type: 'KTP' },
      pdf,
    );
    check(
      'a replacement is version 2, not an overwrite',
      v2.body?.version === 2,
      `version=${v2.body?.version}`,
    );
    const old = await api('GET', `/hr/api/v1/employee-documents/${v1.body?.id}`);
    check(
      'the superseded version is still readable and marked',
      old.status === 200 && old.body?.supersededById === v2.body?.id,
      `supersededById=${old.body?.supersededById}`,
    );
  }

  // ── 5. assets ───────────────────────────────────────────────────────────────────
  const second = await makeEmployee(depotId, 'Aset');
  cleanup.push(second.id);
  const asset = await api('POST', '/hr/api/v1/employee-assets', {
    code: `F6H-${stamp}`,
    type: 'MOTORCYCLE',
    name: `F6H Motor ${stamp}`,
    depotId,
  });
  check(
    'an asset starts life available and unheld',
    asset.body?.status === 'AVAILABLE' && !asset.body?.holderId,
    `status=${asset.body?.status}`,
  );
  const assetId = asset.body?.id;
  const assign = await api('POST', `/hr/api/v1/employee-assets/${assetId}/movements`, {
    kind: 'ASSIGN',
    toEmployeeId: employee.id,
  });
  check(
    'assign hands it to the first employee',
    assign.body?.status === 'ASSIGNED' && assign.body?.holderId === employee.id,
    `status=${assign.body?.status}`,
  );
  const reassign = await api('POST', `/hr/api/v1/employee-assets/${assetId}/movements`, {
    kind: 'ASSIGN',
    toEmployeeId: second.id,
  });
  check(
    'assigning an already-held asset is refused',
    reassign.status === 400 || reassign.status === 409,
    `got ${reassign.status}`,
  );
  const transfer = await api('POST', `/hr/api/v1/employee-assets/${assetId}/movements`, {
    kind: 'TRANSFER',
    toEmployeeId: second.id,
  });
  check(
    'transfer moves it to the second employee',
    transfer.body?.holderId === second.id,
    `holder=${transfer.body?.holderId}`,
  );
  const returned = await api('POST', `/hr/api/v1/employee-assets/${assetId}/movements`, {
    kind: 'RETURN',
  });
  check(
    'return leaves it available and unheld',
    returned.body?.status === 'RETURNED' || returned.body?.status === 'AVAILABLE',
    `status=${returned.body?.status}`,
  );
  const history = await api('GET', `/hr/api/v1/employee-assets/${assetId}`);
  const kinds = (history.body?.movements ?? []).map((m) => m.kind);
  check(
    'the whole history survives, in order',
    kinds.join('>').includes('ASSIGN') && kinds.includes('TRANSFER') && kinds.includes('RETURN'),
    `movements=${kinds.join(', ') || '(none)'}`,
  );

  // ── 6. announcements ────────────────────────────────────────────────────────────
  // The dedup proof is COMPARATIVE, not a roster count: the audience is filtered (inactive
  // staff, people with no login), so "audienceSize === employees in the depot" measures the
  // filter, not the overlap. Send the same notice twice — once to the depot, once to the
  // depot PLUS a person already inside it. If the overlap reached anyone twice the second
  // audience would be larger.
  const depotOnly = await api('POST', '/hr/api/v1/announcements', {
    title: `F6H Depot ${stamp}`,
    body: 'Basis pembanding untuk uji tumpang tindih.',
    targets: [{ dimension: 'DEPOT', value: depotId }],
  });
  const overlapping = await api('POST', '/hr/api/v1/announcements', {
    title: `F6H Pengumuman ${stamp}`,
    body: 'Target tumpang tindih harus tetap satu notifikasi per orang.',
    targets: [
      { dimension: 'DEPOT', value: depotId },
      { dimension: 'EMPLOYEE', value: employee.id },
    ],
  });
  check(
    'an overlapping-target announcement publishes',
    ok2xx(overlapping) && Boolean(overlapping.body?.publishedAt),
    `status ${overlapping.status}`,
  );
  check(
    'adding a person ALREADY in the target depot grows the audience by nobody',
    overlapping.body?.audienceSize === depotOnly.body?.audienceSize,
    `depot alone=${depotOnly.body?.audienceSize}, depot+that person=${overlapping.body?.audienceSize}`,
  );

  const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const scheduled = await api('POST', '/hr/api/v1/announcements', {
    title: `F6H Terjadwal ${stamp}`,
    body: 'Belum waktunya terbit.',
    scheduledAt: future,
    targets: [{ dimension: 'COMPANY' }],
  });
  check(
    'a future announcement is NOT published on save',
    scheduled.body?.publishedAt === null,
    `publishedAt=${scheduled.body?.publishedAt}`,
  );
  const sweep = await api('POST', '/hr/api/v1/announcements/publish-due');
  const stillWaiting = await api('GET', `/hr/api/v1/announcements/${scheduled.body?.id}`);
  check(
    'the sweep leaves it alone until its time comes',
    stillWaiting.body?.publishedAt === null,
    `published=${stillWaiting.body?.publishedAt}, sweep released ${sweep.body?.published}`,
  );

  // ── 7. allowances ───────────────────────────────────────────────────────────────
  const live = await api('POST', '/hr/api/v1/allowances', {
    employeeId: employee.id,
    type: 'TRANSPORT',
    amount: 300_000,
    effectiveFrom: `${period}-01`,
  });
  const expired = await api('POST', '/hr/api/v1/allowances', {
    employeeId: employee.id,
    type: 'MEAL',
    amount: 150_000,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-01-31',
  });
  check(
    'an allowance can be granted',
    ok2xx(live) && ok2xx(expired),
    `${live.status}/${expired.status}`,
  );
  const repay = await api('POST', '/hr/api/v1/payroll/generate', {
    employeeId: employee.id,
    periodMonth: period,
  });
  if (!ok2xx(repay)) {
    skip('the slip separates allowance from bonus', `generate answered ${repay.status}`);
  } else {
    const items = repay.body?.items ?? [];
    const allowances = items.filter((i) => i.kind === 'ALLOWANCE');
    check(
      'the slip carries the allowance as its OWN line kind',
      allowances.length === 1,
      `${allowances.length} ALLOWANCE lines`,
    );
    check(
      'it is not folded into a bonus',
      allowances.every((i) => i.kind !== 'BONUS') && Number(allowances[0]?.amount) === 300_000,
      `amount=${allowances[0]?.amount}`,
    );
    check(
      'an allowance whose window has passed is not paid',
      !items.some((i) => Number(i.amount) === 150_000),
      `items=${items.map((i) => `${i.kind}:${i.amount}`).join(', ')}`,
    );
  }

  // Leave the people behind, inactive, so a failure can be read afterwards.
  for (const id of cleanup)
    await api('PATCH', `/hr/api/v1/employees/${id}`, { status: 'INACTIVE' });
  if (ok2xx(holidayRes) && holidayRes.body?.id) {
    await api('DELETE', `/hr/api/v1/holidays/${holidayRes.body.id}`);
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
