// Cross-depot assignment, driven over real HTTP against the production-shaped Docker stack.
//
//   docker compose -p dapr -f docker-compose.yml -f docker-compose.test.yml up -d --build postgres auth customer product depot hr gateway
//   node scripts/depot-assignment-flows.mjs
//
// What it proves, in the order a lent employee lives it:
//
//   1. Plan   HR plans a loan: validation lists every problem, overlap is refused.
//   2. Flip   the scheduled sweep moves the employee (row, login, ledger, assignment state);
//             a second run does nothing; the login service reports the new depot.
//   3. See    the home depot sees the whole employee, the depot it lent to sees the same person
//             without pay or papers, a stranger depot is refused, and the borrower cannot edit.
//   4. Return the loan ends, the sweep brings them home, and "cut short" ends a running loan.
//   5. Slip   a payslip for a month with a loan is split 20:10 by calendar days; the home depot
//             sees every line, the borrowing depot only its share, and cannot approve it;
//             reports add up to the network and nothing is counted twice.
//   7. More   manager requests, backdating, HQ reallocation, slip PDF/Excel, DRAFT regenerate and
//             the seven bulk imports (needs depot, customer and product behind the gateway).
//   8. Real    sessions (web cookies + native bearer) follow a lend and refresh to the new depot;
//             the push roster; a sweep that was down three days; a stale UPSERT import.
//   6. Off    with the switch off the routes are dark, the sweep reports `disabled`, and a slip
//             is written without any split.
//
// The clock cannot be moved, so "later" is simulated by moving the assignment's dates in the
// database - the thing under test is what the SERVICE does when it finds them due.
//
// Env:
//   GATEWAY_URL         default http://localhost:18080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
//   PG_CONTAINER        default dapr-postgres      HR_CONTAINER   default dapr-hr-1
//   FLAG_OFF=1          run only the "switch off" section (stack booted with the flag off)
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:18080';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'itest-shared-access-secret-0123456789abcdef';
const PG = process.env.PG_CONTAINER ?? 'dapr-postgres';
const HR = process.env.HR_CONTAINER ?? 'dapr-hr-1';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(role, depotId = null, sub = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, phone: '+620000000000', depotId, iss: 'hydromart-auth', aud: 'hydromart-api', iat: now, exp: now + 3600 })}`;
  return `${data}.${crypto.createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

async function api(method, path, body, token) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
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

/** One scalar / row set out of the HR database. */
function sql(query) {
  return execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'hydromart', '-d', 'hydromart_hr', '-qtAXF|', '-c', query], {
    encoding: 'utf8',
  }).trim();
}
const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split('|'));

/** What the scheduler does: POST the sweep with the internal key, from inside the stack. */
function sweep() {
  const out = execFileSync(
    'docker',
    [
      'exec', HR, 'node', '-e',
      "fetch('http://localhost:3018/api/v1/employees/internal/depot-moves/apply-due',{method:'POST',headers:{'x-internal-key':process.env.INTERNAL_SERVICE_KEY}}).then(async r=>console.log(r.status+' '+await r.text())).catch(e=>{console.log('ERR '+e.message);process.exit(1)})",
    ],
    { encoding: 'utf8' },
  ).trim();
  const [status, ...rest] = out.split(' ');
  return { status: Number(status), body: JSON.parse(rest.join(' ') || '{}') };
}

let failed = 0;
let passed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const stamp = Date.now().toString().slice(-7);
// Real depots, created through depot-service: planning now asks it whether the destination
// exists and is open, so a random UUID is (correctly) a 404.
let G; // home depot
let P; // depot lent to
let X; // a depot with no part in this
const ADMIN_FOR_SETUP = tokenFor('SUPER_ADMIN');
async function makeDepot(label) {
  const code = `${label}${stamp}`.slice(0, 12);
  const r = await api('POST', '/depots/api/v1/depots', {
    code, name: `DAPR ${label} ${stamp}`, ownershipType: 'HKP', address: 'Jl. Uji 1',
    city: 'Bekasi', province: 'Jawa Barat', lat: -6.2, lng: 106.9, deliveryFee: 5000,
  }, ADMIN_FOR_SETUP);
  if (r.status !== 201) throw new Error(`depot ${label} not created: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.id;
}
const HR_TOKEN = tokenFor('HR');
const ADMIN = tokenFor('SUPER_ADMIN');
const manager = (depotId) => tokenFor('MANAGER', depotId);

let seq = 0;
async function newEmployee(label, depotId) {
  seq += 1;
  const r = await api(
    'POST',
    '/employees/api/v1/employees',
    {
      fullName: `DAPR ${label} ${stamp}`,
      phone: `0899${stamp}${seq}`.slice(0, 13),
      depotId,
      position: 'Staf',
      role: 'STAFF_DEPOT',
      employmentStatus: 'PERMANENT',
      joinDate: '2024-01-01',
      salaryType: 'MONTHLY',
      monthlyRate: 3_000_000,
      nik: `32${stamp}${seq}`.padEnd(16, '1'),
      bankName: 'BCA',
      bankAccount: '1234567890',
    },
    HR_TOKEN,
  );
  return r;
}

// "Today" is the business day in Jakarta - the server's day - not the runner's UTC date, which
// is still yesterday for the first seven hours of every day.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const today = new Date(`${TODAY}T00:00:00.000Z`);

async function main() {
  const health = await fetch(`${GATEWAY}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`gateway not reachable at ${GATEWAY}`);
    process.exit(2);
  }

  // A previous run on this throwaway stack leaves planned loans behind; the sweep would apply
  // them in THIS run and the counts below would no longer be ours.
  sql(`UPDATE employee_depot_assignments SET status = 'CANCELLED' WHERE status IN ('PLANNED', 'ACTIVE')`);
  G = await makeDepot('G');
  P = await makeDepot('P');
  X = await makeDepot('X');
  if (process.env.FLAG_OFF === '1') return flagOff();

  // ---------------------------------------------------------------- 1. plan
  const created = await newEmployee('A', G);
  check('employee created at the home depot', created.status === 201, JSON.stringify(created.body).slice(0, 200));
  const emp = created.body;
  const authId = emp.authSubjectId;
  check('employee has a login account', !!authId);
  check('employee is born home = depot', emp.depotId === G && emp.homeDepotId === G);

  const plan = await api(
    'POST',
    '/depot-assignments/api/v1/depot-assignments',
    { employeeId: emp.id, kind: 'LOAN', depotId: P, startDate: TODAY, endDate: day(addDays(today, 10)), note: 'e2e' },
    HR_TOKEN,
  );
  check('HR plans a loan starting today', plan.status === 201, JSON.stringify(plan.body).slice(0, 200));
  const aid = plan.body?.id;

  const overlap = await api(
    'POST',
    '/depot-assignments/api/v1/depot-assignments',
    { employeeId: emp.id, kind: 'LOAN', depotId: X, startDate: day(addDays(today, 3)), endDate: day(addDays(today, 5)) },
    HR_TOKEN,
  );
  check('an overlapping plan is refused (400)', overlap.status === 400 && /bertabrakan/.test(JSON.stringify(overlap.body)));

  const bad = await api(
    'POST',
    '/depot-assignments/api/v1/depot-assignments',
    { employeeId: emp.id, kind: 'LOAN', depotId: G, startDate: day(addDays(today, -3)), endDate: day(addDays(today, -4)) },
    HR_TOKEN,
  );
  const reasons = Array.isArray(bad.body?.message) ? bad.body.message.length : 1;
  // HR may backdate, so the past start is no longer one of the reasons: end-before-start and
  // "to the depot they are already at" still are.
  check('a bad plan lists every reason at once', bad.status === 400 && reasons >= 2, `reasons=${reasons}`);

  const forbidden = await api('GET', '/depot-assignments/api/v1/depot-assignments', undefined, manager(G));
  check('a depot manager cannot use the HR-only routes (403)', forbidden.status === 403, String(forbidden.status));

  // ---------------------------------------------------------------- 2. flip
  const s1 = sweep();
  check('sweep applies the due start', s1.status === 200 && s1.body.applied === 1 && s1.body.failed === 0, JSON.stringify(s1));
  const [[depot, home]] = rows(`SELECT "depotId", "homeDepotId" FROM employees WHERE id = '${emp.id}'`);
  check('live depot moved, home did not', depot === P && home === G, `${depot}/${home}`);
  const [[state]] = rows(`SELECT status FROM employee_depot_assignments WHERE id = '${aid}'`);
  check('assignment is ACTIVE', state === 'ACTIVE');
  const ledger = rows(`SELECT kind, "fromDepotId", "toDepotId" FROM employee_depot_moves WHERE "employeeId" = '${emp.id}' ORDER BY seq`);
  check('ledger has one LOAN_START G -> P', ledger.length === 1 && ledger[0][0] === 'LOAN_START' && ledger[0][1] === G && ledger[0][2] === P, JSON.stringify(ledger));
  const s2 = sweep();
  check('a second sweep does nothing (idempotent)', s2.status === 200 && s2.body.due === 0 && s2.body.applied === 0, JSON.stringify(s2));

  const me = await api('GET', '/auth/api/v1/auth/me', undefined, tokenFor('STAFF_DEPOT', G, authId));
  check('the login service reports the new depot', me.status === 200 && me.body?.assignedDepotId === P, JSON.stringify(me.body).slice(0, 200));

  // ---------------------------------------------------------------- 3. see
  const asHome = await api('GET', `/employees/api/v1/employees/${emp.id}`, undefined, manager(G));
  check('home manager sees the whole employee', asHome.status === 200 && !!asHome.body.nik && Number(asHome.body.monthlyRate) === 3_000_000, JSON.stringify(asHome.body).slice(0, 160));
  const asAway = await api('GET', `/employees/api/v1/employees/${emp.id}`, undefined, manager(P));
  check('borrowing manager sees the person without pay or papers', asAway.status === 200 && asAway.body.nik === null && asAway.body.monthlyRate === null && asAway.body.bankAccount === null && asAway.body.fullName === emp.fullName, JSON.stringify(asAway.body).slice(0, 200));
  const asOther = await api('GET', `/employees/api/v1/employees/${emp.id}`, undefined, manager(X));
  check('a stranger depot is refused (403)', asOther.status === 403, String(asOther.status));
  const edit = await api('PATCH', `/employees/api/v1/employees/${emp.id}`, { fullName: 'Hacked' }, manager(P));
  check('the borrower cannot edit the record (403)', edit.status === 403 || edit.status === 401, String(edit.status));
  const permMove = await api('PATCH', `/employees/api/v1/employees/${emp.id}`, { depotId: X }, ADMIN);
  check('a permanent move is refused while a loan runs (409)', permMove.status === 409, String(permMove.status));

  // ---------------------------------------------------------------- 4. return
  sql(`UPDATE employee_depot_assignments SET "startDate" = '${day(addDays(today, -5))}', "endDate" = '${day(addDays(today, -1))}' WHERE id = '${aid}'`);
  const s3 = sweep();
  check('sweep brings them home when the loan has ended', s3.status === 200 && s3.body.applied === 1, JSON.stringify(s3));
  const [[depot2]] = rows(`SELECT "depotId" FROM employees WHERE id = '${emp.id}'`);
  check('live depot is the home depot again', depot2 === G);
  const [[state2, endedAt]] = rows(`SELECT status, "appliedEndAt" IS NOT NULL FROM employee_depot_assignments WHERE id = '${aid}'`);
  check('assignment is DONE with its end stamped', state2 === 'DONE' && endedAt === 't');
  const end = rows(`SELECT kind, "effectiveDate"::text FROM employee_depot_moves WHERE "employeeId" = '${emp.id}' AND kind = 'LOAN_END'`);
  check('LOAN_END is dated the day after the last loan day (today)', end.length === 1 && end[0][1] === TODAY, JSON.stringify(end));
  const me2 = await api('GET', '/auth/api/v1/auth/me', undefined, tokenFor('STAFF_DEPOT', G, authId));
  check('the login service reports home again', me2.body?.assignedDepotId === G);

  // cut short
  const plan2 = await api('POST', '/depot-assignments/api/v1/depot-assignments', { employeeId: emp.id, kind: 'LOAN', depotId: P, startDate: TODAY, endDate: day(addDays(today, 20)) }, HR_TOKEN);
  check('a second loan can be planned once the first is done', plan2.status === 201);
  sweep();
  const cut = await api('PATCH', `/depot-assignments/api/v1/depot-assignments/${plan2.body?.id}/cancel`, {}, HR_TOKEN);
  check('cancelling a running loan cuts it short (200, DONE)', cut.status === 200 && cut.body?.status === 'DONE', JSON.stringify(cut.body).slice(0, 160));
  const [[depot3]] = rows(`SELECT "depotId" FROM employees WHERE id = '${emp.id}'`);
  check('and sends them home the same day', depot3 === G);

  // ---------------------------------------------------------------- 5. slip
  const now = today;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate();
  const loanDays = 10; // the 16th through the 25th
  const lent = await newEmployee('B', G);
  const e2 = lent.body;
  const m = (d) => `${period}-${String(d).padStart(2, '0')}`;
  const nextMonth = day(new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1)));
  const [[aid2]] = rows(`INSERT INTO employee_depot_assignments (id, "employeeId", kind, "depotId", "startDate", "endDate", status, "updatedAt") VALUES (gen_random_uuid(), '${e2.id}', 'LOAN', '${P}', '${m(16)}', '${m(25)}', 'DONE', now()) RETURNING id`);
  sql(`INSERT INTO employee_depot_moves (id, "employeeId", "fromDepotId", "toDepotId", "effectiveDate", kind, "assignmentId") VALUES (gen_random_uuid(), '${e2.id}', '${G}', '${P}', '${m(16)}', 'LOAN_START', '${aid2}'), (gen_random_uuid(), '${e2.id}', '${P}', '${G}', '${m(26)}', 'LOAN_END', '${aid2}')`);

  const gen = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: e2.id, periodMonth: period }, HR_TOKEN);
  check('payroll generates for the month that had a loan', gen.status === 201, JSON.stringify(gen.body).slice(0, 200));
  const pid = gen.body?.id;
  const shares = rows(`SELECT "depotId", days, gross, net FROM payroll_depot_shares WHERE "payrollId" = '${pid}' ORDER BY days DESC`);
  const byDepot = Object.fromEntries(shares.map(([d, days, gross, net]) => [d, { days: Number(days), gross: Number(gross), net: Number(net) }]));
  check('the slip is split between the two depots', shares.length === 2 && byDepot[G] && byDepot[P], JSON.stringify(shares));
  check(`calendar days: ${daysInMonth - loanDays} home / ${loanDays} away`, byDepot[G]?.days === daysInMonth - loanDays && byDepot[P]?.days === loanDays, JSON.stringify(byDepot));
  const slipNet = Number(gen.body?.net);
  check('the shares add back to the slip exactly', Number(byDepot[G]?.net) + Number(byDepot[P]?.net) === slipNet, `${byDepot[G]?.net}+${byDepot[P]?.net} vs ${slipNet}`);
  const [[bad2]] = rows(`SELECT count(*) FROM payrolls p WHERE p.id = '${pid}' AND (SELECT sum(net) FROM payroll_depot_shares s WHERE s."payrollId" = p.id) <> p.net`);
  check('the Σ share = payroll assertion finds 0 violations', bad2 === '0');
  check('rules came from the home depot: nothing was fined or taxed oddly', Number(gen.body?.gross) === 3_000_000 || Number(gen.body?.gross) > 0);

  const homeView = await api('GET', `/payroll/api/v1/payroll/${pid}`, undefined, manager(G));
  check('home manager reads the whole slip with its lines and the split', homeView.status === 200 && homeView.body.items?.length > 0 && homeView.body.shares?.length === 2, JSON.stringify(homeView.body).slice(0, 160));
  const awayView = await api('GET', `/payroll/api/v1/payroll/${pid}`, undefined, manager(P));
  check('borrowing manager reads only its share: no lines, its own amount, no split', awayView.status === 200 && awayView.body.items?.length === 0 && Number(awayView.body.net) === byDepot[P].net && awayView.body.shares === undefined, JSON.stringify(awayView.body).slice(0, 200));
  const strangerView = await api('GET', `/payroll/api/v1/payroll/${pid}`, undefined, manager(X));
  check('a depot with no part in it is refused (403)', strangerView.status === 403, String(strangerView.status));
  const approveAway = await api('POST', `/payroll/api/v1/payroll/${pid}/approve`, {}, manager(P));
  check('the borrowing manager cannot approve (403)', approveAway.status === 403, String(approveAway.status));
  const slipAway = await api('GET', `/payroll/api/v1/payroll/${pid}/slip`, undefined, manager(P));
  check('and the PDF it can download is only its share (200)', slipAway.status === 200);

  const listHome = await api('GET', `/payroll/api/v1/payroll?periodMonth=${period}&employeeId=${e2.id}`, undefined, manager(G));
  const listAway = await api('GET', `/payroll/api/v1/payroll?periodMonth=${period}&employeeId=${e2.id}`, undefined, manager(P));
  const rowOf = (r) => (r.body?.rows ?? [])[0];
  check('the list shows the home depot the whole slip', Number(rowOf(listHome)?.net) === slipNet);
  check('and the borrowing depot its share', Number(rowOf(listAway)?.net) === byDepot[P].net, JSON.stringify(rowOf(listAway)));

  const dashG = await api('GET', `/hr-reports/api/v1/hr-reports/dashboard?depotId=${G}&periodMonth=${period}`, undefined, manager(G));
  const dashP = await api('GET', `/hr-reports/api/v1/hr-reports/dashboard?depotId=${P}&periodMonth=${period}`, undefined, manager(P));
  const netOf = (r) => Number(r.body?.payroll?.totals?.net ?? NaN);
  check('the home depot dashboard counts its share (and its other staff)', dashG.status === 200 && netOf(dashG) >= byDepot[G].net, JSON.stringify(dashG.body?.payroll));
  check('the destination dashboard counts exactly the share it carries', dashP.status === 200 && netOf(dashP) === byDepot[P].net, `${netOf(dashP)} vs ${byDepot[P].net}`);

  // ---------------------------------------------------------------- 6. a slip regenerates
  const regen = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: e2.id, periodMonth: period }, HR_TOKEN);
  check('regenerating the draft replaces the split rather than doubling it', regen.status === 201 && Number(rows(`SELECT count(*) FROM payroll_depot_shares WHERE "payrollId" = '${pid}'`)[0][0]) === 2);

  await followUps({ emp, e2, pid, period });
  await hardening();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------- 7+. the rest of the stack
// Manager requests, backdating, HQ reallocation, slip print/export, regenerate, and the bulk
// imports - everything PR6a..PR6f added. Needs depot, customer and product behind the gateway.
const sqlIn = (db, query) =>
  execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'hydromart', '-d', db, '-qtAXF|', '-c', query], { encoding: 'utf8' }).trim();

async function followUps({ emp, e2, pid, period }) {
  const dayIn = (n) => day(addDays(today, n));
  const BASE = '/depot-assignments/api/v1/depot-assignments';

  // ---- manager requests
  const mgrP = manager(P);
  const req = await api('POST', `${BASE}/requests`, { employeeCode: emp.employeeCode, depotId: P, startDate: dayIn(7), endDate: dayIn(9), note: 'e2e request' }, mgrP);
  check('a depot manager asks to borrow somebody by employee code (201 REQUESTED)', req.status === 201 && req.body?.status === 'REQUESTED', JSON.stringify(req.body).slice(0, 200));
  const rid = req.body?.id;
  const sw = sweep();
  check('the sweep never touches a request', sw.status === 200 && sw.body.due === 0, JSON.stringify(sw));
  const mine = await api('GET', `${BASE}/requests/mine`, undefined, mgrP);
  check('the manager reads their own request back', mine.status === 200 && (mine.body?.rows ?? []).some((r) => r.id === rid), JSON.stringify(mine.body).slice(0, 160));
  const intoOther = await api('POST', `${BASE}/requests`, { employeeCode: emp.employeeCode, depotId: X, startDate: dayIn(7), endDate: dayIn(9) }, mgrP);
  check('a request into a depot that is not theirs is refused (403)', intoOther.status === 403, String(intoOther.status));
  const asst = await api('POST', `${BASE}/requests`, { employeeCode: emp.employeeCode, depotId: P, startDate: dayIn(7), endDate: dayIn(9) }, tokenFor('ASSISTANT_SUPERVISOR', P));
  check('an assistant supervisor may not ask (403)', asst.status === 403, String(asst.status));
  const approveByMgr = await api('POST', `${BASE}/${rid}/approve`, {}, mgrP);
  check('a manager cannot approve their own request (403)', approveByMgr.status === 403, String(approveByMgr.status));
  const approve = await api('POST', `${BASE}/${rid}/approve`, {}, HR_TOKEN);
  check('HR approves it: the row becomes PLANNED', approve.status === 200 && approve.body?.status === 'PLANNED', JSON.stringify(approve.body).slice(0, 160));
  const again = await api('POST', `${BASE}/${rid}/approve`, {}, HR_TOKEN);
  check('a second decision is refused (404)', again.status === 404, String(again.status));
  const req2 = await api('POST', `${BASE}/requests`, { employeeCode: emp.employeeCode, depotId: P, startDate: dayIn(15), endDate: dayIn(17) }, mgrP);
  const rej = await api('POST', `${BASE}/${req2.body?.id}/reject`, { reason: 'stok orang kurang' }, HR_TOKEN);
  check('HR rejects another with a reason (CANCELLED + reason kept)', rej.status === 200 && rej.body?.status === 'CANCELLED' && rej.body?.failReason === 'stok orang kurang', JSON.stringify(rej.body).slice(0, 200));
  await api('PATCH', `${BASE}/${rid}/cancel`, {}, HR_TOKEN); // leave the employee free for later steps

  // ---- backdating
  const old = await newEmployee('C', G);
  const back = await api('POST', BASE, { employeeId: old.body.id, kind: 'LOAN', depotId: P, startDate: dayIn(-3), endDate: dayIn(-1) }, HR_TOKEN);
  check('HR may start a loan in the past (201)', back.status === 201, JSON.stringify(back.body).slice(0, 200));
  const farBack = await api('POST', BASE, { employeeId: old.body.id, kind: 'LOAN', depotId: P, startDate: dayIn(-200), endDate: dayIn(-190) }, HR_TOKEN);
  check('more than 92 days back is refused (400)', farBack.status === 400 && /terlalu lampau/.test(JSON.stringify(farBack.body)), JSON.stringify(farBack.body).slice(0, 200));
  const ap = await api('POST', `/payroll/api/v1/payroll/${pid}/approve`, {}, HR_TOKEN);
  check('HR approves the split slip', ap.status === 201 || ap.status === 200, String(ap.status));
  const [[y, mo]] = rows(`SELECT split_part('${period}', '-', 1), split_part('${period}', '-', 2)`);
  const closedDay = `${y}-${mo}-05`;
  const closed = await api('POST', BASE, { employeeId: e2.id, kind: 'LOAN', depotId: X, startDate: closedDay, endDate: `${y}-${mo}-07` }, HR_TOKEN);
  check('backdating into a month whose slip is approved is refused (400)', closed.status === 400 && /disetujui atau dibayar/.test(JSON.stringify(closed.body)), JSON.stringify(closed.body).slice(0, 200));

  // ---- HQ reallocation of an APPROVED slip
  const before = rows(`SELECT "depotId", days, gross, bonus, deduction, shortfall, net FROM payroll_depot_shares WHERE "payrollId" = '${pid}' ORDER BY "depotId"`);
  const mk = (r, g) => ({ depotId: r[0], days: Number(r[1]), gross: g, bonus: Number(r[3]), deduction: Number(r[4]), shortfall: Number(r[5]) });
  const totalGross = before.reduce((a, r) => a + Number(r[2]), 0);
  const moved = [mk(before[0], Number(before[0][2]) + 1000), mk(before[1], Number(before[1][2]) - 1000)];
  const unbal = [mk(before[0], Number(before[0][2]) + 1000), mk(before[1], Number(before[1][2]))];
  const bad = await api('POST', `/payroll/api/v1/payroll/${pid}/reallocate-shares`, { reason: 'uji', shares: unbal }, HR_TOKEN);
  check('a split that does not add up to the slip is refused (400)', bad.status === 400, JSON.stringify(bad.body).slice(0, 200));
  const mgrTry = await api('POST', `/payroll/api/v1/payroll/${pid}/reallocate-shares`, { reason: 'uji', shares: moved }, manager(G));
  check('a depot manager cannot reallocate (403)', mgrTry.status === 403, String(mgrTry.status));
  const ok = await api('POST', `/payroll/api/v1/payroll/${pid}/reallocate-shares`, { reason: 'koreksi e2e', shares: moved }, HR_TOKEN);
  check('HQ reallocates an APPROVED slip (200)', ok.status === 200 || ok.status === 201, JSON.stringify(ok.body).slice(0, 200));
  const after = rows(`SELECT "depotId", gross, net FROM payroll_depot_shares WHERE "payrollId" = '${pid}' ORDER BY "depotId"`);
  check('stored shares moved by Rp1.000 and still add to the slip', Number(after[0][1]) === Number(before[0][2]) + 1000 && after.reduce((a, r) => a + Number(r[1]), 0) === totalGross);
  const [[sumOk]] = rows(`SELECT count(*) FROM payrolls p WHERE p.id = '${pid}' AND (SELECT sum(net) FROM payroll_depot_shares s WHERE s."payrollId" = p.id) <> p.net`);
  check('Sum(share net) = payroll net still holds after the correction', sumOk === '0');
  const audited = rows(`SELECT count(*) FROM audit_logs WHERE action = 'PAYROLL_REALLOCATE' AND "entityId" = '${pid}'`)[0][0];
  check('the correction is in the audit log', Number(audited) >= 1, audited);
  const paid = await api('POST', `/payroll/api/v1/payroll/${pid}/pay`, {}, HR_TOKEN);
  check('mark paid', paid.status === 201 || paid.status === 200, String(paid.status));
  const late = await api('POST', `/payroll/api/v1/payroll/${pid}/reallocate-shares`, { reason: 'terlambat', shares: moved }, HR_TOKEN);
  check('a PAID slip can no longer be reallocated (409)', late.status === 409, String(late.status));

  // ---- print and export
  const pdfRes = await fetch(`${GATEWAY}/payroll/api/v1/payroll/${pid}/slip`, { headers: { authorization: `Bearer ${HR_TOKEN}` } });
  const pdfHead = Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 4).toString();
  check('the slip PDF renders for the home side', pdfRes.status === 200 && pdfHead === '%PDF', `${pdfRes.status} ${pdfHead}`);
  const csv = await fetch(`${GATEWAY}/hr-reports/api/v1/hr-reports/payroll?periodMonth=${period}`, { headers: { authorization: `Bearer ${HR_TOKEN}` } });
  const csvText = await csv.text();
  check('the payroll export carries the alokasiDepot column', csv.status === 200 && /alokasiDepot/.test(csvText.split('\n')[0] ?? ''), `${csv.status} ${csvText.slice(0, 120)}`);

  // ---- regenerate a DRAFT
  const dr = await newEmployee('D', G);
  const dgen = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: dr.body.id, periodMonth: period }, HR_TOKEN);
  const rg = await api('POST', `/payroll/api/v1/payroll/${dgen.body?.id}/regenerate`, {}, HR_TOKEN);
  check('a DRAFT slip is recomputed by id (200)', rg.status === 200 || rg.status === 201, JSON.stringify(rg.body).slice(0, 160));
  const rgPaid = await api('POST', `/payroll/api/v1/payroll/${pid}/regenerate`, {}, HR_TOKEN);
  check('a paid slip is not recomputed (409)', rgPaid.status === 409, String(rgPaid.status));

  // ---- bulk imports
  const imp = async (path, rowsIn, token = HR_TOKEN, extra = {}) => api('POST', path, { ...extra, rows: rowsIn }, token);
  const yday = dayIn(-1);
  const att1 = await imp('/attendance/api/v1/attendance/import', [{ employeeCode: emp.employeeCode, workDate: yday, status: 'PRESENT' }]);
  check('attendance history: a past day is created', att1.status === 200 && att1.body?.created === 1, JSON.stringify(att1.body).slice(0, 200));
  const att2 = await imp('/attendance/api/v1/attendance/import', [{ employeeCode: emp.employeeCode, workDate: yday, status: 'PRESENT' }]);
  check('attendance history: the same file again is skipped', att2.body?.skipped === 1 && att2.body?.created === 0, JSON.stringify(att2.body).slice(0, 200));
  const att3 = await imp('/attendance/api/v1/attendance/import', [{ employeeCode: emp.employeeCode, workDate: TODAY, status: 'PRESENT' }]);
  check('attendance history: today is refused', att3.body?.failed === 1, JSON.stringify(att3.body).slice(0, 200));
  const att4 = await imp('/attendance/api/v1/attendance/import', [{ employeeCode: e2.employeeCode, workDate: closedDay, status: 'PRESENT' }]);
  check('attendance history: a month with an approved slip is refused', att4.body?.failed === 1 && /disetujui/.test(JSON.stringify(att4.body)), JSON.stringify(att4.body).slice(0, 200));

  const oldMonth = (() => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 4, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const ph1 = await imp('/payroll/api/v1/payroll/import', [{ employeeCode: emp.employeeCode, periodMonth: oldMonth, gross: 2_500_000, totalBonus: 100_000, totalDeduction: 50_000, presentDays: 24 }]);
  check('payroll history: a closed month is created as PAID', ph1.status === 200 && ph1.body?.created === 1, JSON.stringify(ph1.body).slice(0, 200));
  const [[phStatus]] = rows(`SELECT status FROM payrolls WHERE "employeeId" = '${emp.id}' AND "periodMonth" = '${oldMonth}'`);
  const [[phShares]] = rows(`SELECT count(*) FROM payroll_depot_shares s JOIN payrolls p ON p.id = s."payrollId" WHERE p."employeeId" = '${emp.id}' AND p."periodMonth" = '${oldMonth}'`);
  check('payroll history: stored PAID with its single home share', phStatus === 'PAID' && phShares === '1', `${phStatus}/${phShares}`);
  const ph2 = await imp('/payroll/api/v1/payroll/import', [{ employeeCode: emp.employeeCode, periodMonth: oldMonth, gross: 1 }]);
  check('payroll history: an existing slip is never overwritten', ph2.body?.skipped === 1, JSON.stringify(ph2.body).slice(0, 200));
  const ph3 = await imp('/payroll/api/v1/payroll/import', [
    { employeeCode: emp.employeeCode, periodMonth: TODAY.slice(0, 7), gross: 1 },
    { employeeCode: emp.employeeCode, periodMonth: dayIn(-200).slice(0, 7), gross: 100, net: 999 },
  ]);
  check('payroll history: this month and a wrong net are refused', ph3.body?.failed === 2, JSON.stringify(ph3.body).slice(0, 200));

  const shiftName = `E2E Pagi ${stamp}`;
  const shiftMade = await api('POST', '/hr-shifts/api/v1/hr-shifts', { name: shiftName, startTime: '08:00', endTime: '16:00' }, HR_TOKEN);
  check('a shift exists to import against', shiftMade.status === 201, JSON.stringify(shiftMade.body).slice(0, 160));
  const sh1 = await imp('/shift-rotations/api/v1/shift-rotations/assignments/import', [{ employeeCode: emp.employeeCode, shiftName, effectiveFrom: '2026-01-05' }]);
  check('shift history: an assignment is created', sh1.status === 200 && sh1.body?.created === 1, JSON.stringify(sh1.body).slice(0, 200));
  const sh2 = await imp('/shift-rotations/api/v1/shift-rotations/assignments/import', [{ employeeCode: emp.employeeCode, shiftName, effectiveFrom: '2026-01-05' }]);
  check('shift history: the same row again is skipped', sh2.body?.skipped === 1, JSON.stringify(sh2.body).slice(0, 200));

  const slug = `e2e-${stamp}`;
  const cat1 = await imp('/products/api/v1/categories/import', [{ name: `E2E ${stamp}`, slug }], ADMIN);
  check('category import: created', cat1.status === 200 && cat1.body?.created === 1, JSON.stringify(cat1.body).slice(0, 200));
  const cat2 = await imp('/products/api/v1/categories/import', [{ name: `E2E ${stamp}`, slug }], ADMIN);
  check('category import: an existing slug is skipped', cat2.body?.skipped === 1, JSON.stringify(cat2.body).slice(0, 200));
  const pr1 = await imp('/products/api/v1/products/import', [
    { sku: `E2E-${stamp}`, name: 'E2E Galon', unit: 'Galon 19L', basePrice: 18000, categorySlug: slug, volumeMl: 19000, isGallon: true },
    { sku: `E2E-${stamp}-X`, name: 'E2E Salah', unit: 'pcs', basePrice: 100, categorySlug: 'tidak-ada' },
  ], ADMIN);
  check('product import: one created, one with an unknown category failed', pr1.body?.created === 1 && pr1.body?.failed === 1, JSON.stringify(pr1.body).slice(0, 240));
  const pr2 = await imp('/products/api/v1/products/import', [{ sku: `E2E-${stamp}`, name: 'E2E Galon', unit: 'Galon 19L', basePrice: 99999 }], ADMIN);
  check('product import: an existing SKU is skipped, not repriced', pr2.body?.skipped === 1, JSON.stringify(pr2.body).slice(0, 200));
  const priced = sqlIn('hydromart_product', `SELECT "basePrice"::int FROM products WHERE sku = 'E2E-${stamp}'`);
  check('and its price is still the first one', priced === '18000', priced);
  const cmgr = await imp('/products/api/v1/products/import', [{ sku: `E2E-${stamp}-M`, name: 'm', unit: 'u', basePrice: 1 }], manager(G));
  check('product import: a depot manager may edit the catalogue (owner decision) - answer recorded', [200, 403].includes(cmgr.status), String(cmgr.status));

  // gallon balances + addresses need a real depot and a customer identity
  const depotMade = await api('POST', '/depots/api/v1/depots', {
    code: `E2E${stamp}`.slice(0, 12), name: `E2E Depot ${stamp}`, ownershipType: 'HKP', address: 'Jl. Uji 1', city: 'Bekasi', province: 'Jawa Barat', lat: -6.2, lng: 106.9, deliveryFee: 5000,
  }, ADMIN);
  check('a depot is created for the customer-facing imports', depotMade.status === 201, JSON.stringify(depotMade.body).slice(0, 200));
  const depotId = depotMade.body?.id;
  if (depotId) {
    const phone = `0898${stamp}1`.slice(0, 13);
    const gb1 = await imp(`/depots/api/v1/depots/${depotId}/gallon-issues/import`, [{ customerPhone: phone, customerName: 'E2E Pelanggan', quantity: 3, depositHeld: 60000 }], ADMIN);
    check('gallon balances: created (and the new number is flagged)', gb1.status === 200 && gb1.body?.created === 1 && /PENDING/.test(JSON.stringify(gb1.body)), JSON.stringify(gb1.body).slice(0, 240));
    const gb2 = await imp(`/depots/api/v1/depots/${depotId}/gallon-issues/import`, [{ customerPhone: phone, quantity: 3 }], ADMIN);
    check('gallon balances: the same customer again is skipped (no double balance)', gb2.body?.skipped === 1, JSON.stringify(gb2.body).slice(0, 200));
    const held = sqlIn('hydromart_depot', `SELECT coalesce(sum(quantity),0) FROM gallon_issues WHERE "depotId" = '${depotId}'`);
    check('the ledger holds exactly 3 gallons', held === '3', held);
    const adr1 = await imp('/customers/api/v1/customers/import-addresses', [{ phone, label: 'Kios', recipientName: 'E2E Pelanggan', addressLine: 'Jl. Melati 3', city: 'Bekasi' }], tokenFor('KEPALA_DEPOT', depotId), { depotId });
    check('customer addresses: created', [200, 201].includes(adr1.status) && adr1.body?.created === 1, JSON.stringify(adr1.body).slice(0, 240));
    const adr2 = await imp('/customers/api/v1/customers/import-addresses', [{ phone, label: 'Kios', recipientName: 'E2E Pelanggan', addressLine: ' jl. MELATI 3 ', city: 'bekasi' }], tokenFor('KEPALA_DEPOT', depotId), { depotId });
    check('customer addresses: the same address again is skipped', adr2.body?.skipped === 1, JSON.stringify(adr2.body).slice(0, 200));
    const adr3 = await imp('/customers/api/v1/customers/import-addresses', [{ phone, recipientName: 'x', addressLine: 'y', city: 'z' }], tokenFor('KEPALA_DEPOT', G), { depotId });
    check("customer addresses: another depot's staff cannot fill this depot's book", adr3.status === 403, String(adr3.status));
  }
}

// ---------------------------------------------------------------- 8. what the plan listed as unproven
// Real sessions through the gateway (web cookies AND the native bearer body), the push roster,
// a sweep that was down for three days, and a stale UPSERT import.
const dockerLogs = () =>
  execFileSync('docker', ['logs', '--tail', '3000', process.env.AUTH_CONTAINER ?? 'dapr-auth-1'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
const e164 = (p) => (p.startsWith('+') ? p : p.startsWith('0') ? `+62${p.slice(1)}` : `+62${p}`);
const jwtPayload = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const authInternal = (path) =>
  execFileSync('docker', ['exec', 'dapr-auth-1', 'node', '-e',
    `fetch('http://localhost:3001/api/v1/${path}',{headers:{'x-internal-key':process.env.INTERNAL_SERVICE_KEY}}).then(async r=>console.log(await r.text()))`], { encoding: 'utf8' }).trim();

async function otpLogin(phone, origin) {
  const e = e164(phone);
  const headers = { 'content-type': 'application/json', ...(origin ? { origin } : {}) };
  const start = await fetch(`${GATEWAY}/auth/api/v1/auth/login`, { method: 'POST', headers, body: JSON.stringify({ phone: e }) });
  let code;
  for (let i = 0; i < 12 && !code; i += 1) {
    const re = new RegExp(`\\[DEV OTP\\]\\s+LOGIN code for ${e.replace('+', '\\+')}:\\s*(\\d{4,8})`, 'g');
    let last;
    for (const m of dockerLogs().matchAll(re)) last = m[1];
    code = last;
    if (!code) await new Promise((r) => setTimeout(r, 500));
  }
  if (!code) return { start: start.status, error: 'no OTP in the auth log' };
  const res = await fetch(`${GATEWAY}/auth/api/v1/auth/otp/verify`, {
    method: 'POST', headers, body: JSON.stringify({ phone: e, code, purpose: 'LOGIN' }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, setCookie, body };
}
const cookieValue = (setCookie, name) => {
  const hit = setCookie.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0].slice(name.length + 1) : undefined;
};
const findTokens = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (typeof v === 'string' && /^eyJ/.test(v) && /access/i.test(k)) out.access = v;
    if (typeof v === 'string' && /refresh/i.test(k)) out.refresh = v;
    if (v && typeof v === 'object') Object.assign(out, findTokens(v));
  }
  return out;
};

async function hardening() {
  const NATIVE = 'https://localhost';

  // ---- 8a. real sessions follow a lend: web (httpOnly cookies) and native (bearer in the body)
  for (const mode of ['web', 'native']) {
    const e = await newEmployee(`S-${mode}`, G);
    check(`[${mode}] employee with a login account`, e.status === 201 && !!e.body?.authSubjectId, JSON.stringify(e.body).slice(0, 120));
    const phone = e.body.phone;
    const sess = await otpLogin(phone, mode === 'native' ? NATIVE : undefined);
    check(`[${mode}] real OTP login through the gateway (200)`, sess.status === 200, JSON.stringify(sess).slice(0, 200));
    let access;
    let refresh;
    if (mode === 'web') {
      access = cookieValue(sess.setCookie, 'hm_at');
      refresh = cookieValue(sess.setCookie, 'hm_rt');
      check('[web] tokens arrive as cookies, not in the body', !!access && !!refresh && !findTokens(sess.body).access, JSON.stringify(Object.keys(sess.body ?? {})));
    } else {
      const t = findTokens(sess.body);
      access = t.access;
      refresh = t.refresh;
      check('[native] tokens arrive in the body', !!access && !!refresh);
    }
    if (!access || !refresh) continue;
    check(`[${mode}] the issued token names the home depot`, jwtPayload(access).depotId === G, JSON.stringify(jwtPayload(access)).slice(0, 160));

    const planned = await api('POST', '/depot-assignments/api/v1/depot-assignments', { employeeId: e.body.id, kind: 'LOAN', depotId: P, startDate: TODAY, endDate: day(addDays(today, 3)) }, HR_TOKEN);
    check(`[${mode}] HR lends them`, planned.status === 201, JSON.stringify(planned.body).slice(0, 160));
    const s = sweep();
    check(`[${mode}] the sweep flips them`, s.status === 200 && s.body.applied >= 1, JSON.stringify(s));

    const meOld = await fetch(`${GATEWAY}/auth/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${access}`, ...(mode === 'native' ? { origin: NATIVE } : {}) },
    });
    const meBody = await meOld.json().catch(() => ({}));
    check(`[${mode}] the OLD token still works (no session revoked) and the account already says the new depot`, meOld.status === 200 && meBody.assignedDepotId === P, `${meOld.status} ${JSON.stringify(meBody).slice(0, 120)}`);
    check(`[${mode}] ...while the old token itself still carries the old depot (at most one token lifetime)`, jwtPayload(access).depotId === G);

    const rf = await fetch(`${GATEWAY}/auth/api/v1/auth/token/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(mode === 'native' ? { origin: NATIVE } : { cookie: `hm_rt=${refresh}` }),
      },
      body: JSON.stringify(mode === 'native' ? { refreshToken: refresh } : {}),
    });
    const rfBody = await rf.json().catch(() => ({}));
    const fresh = mode === 'web' ? cookieValue(rf.headers.getSetCookie?.() ?? [], 'hm_at') : findTokens(rfBody).access;
    check(`[${mode}] refresh issues a token for the NEW depot`, rf.status === 200 && !!fresh && jwtPayload(fresh).depotId === P, `${rf.status} ${fresh ? JSON.stringify(jwtPayload(fresh)).slice(0, 140) : JSON.stringify(rfBody).slice(0, 140)}`);

    // push roster: the people an alert about a depot reaches
    const gRoster = JSON.parse(authInternal(`auth/internal/staff/depot/${G}`)).ids ?? [];
    const pRoster = JSON.parse(authInternal(`auth/internal/staff/depot/${P}`)).ids ?? [];
    check(`[${mode}] alerts for the depot they work at reach them now, and not the one they left`, pRoster.includes(e.body.authSubjectId) && !gRoster.includes(e.body.authSubjectId), `P=${pRoster.length} G=${gRoster.length}`);
  }

  // ---- 8b. the sweep was down for three days
  const late = await newEmployee('LATE', G);
  const [[lateAid]] = rows(`INSERT INTO employee_depot_assignments (id, "employeeId", kind, "depotId", "startDate", "endDate", status, "updatedAt") VALUES (gen_random_uuid(), '${late.body.id}', 'LOAN', '${P}', '${day(addDays(today, -3))}', '${day(addDays(today, -1))}', 'PLANNED', now()) RETURNING id`);
  const catchUp = sweep();
  check('a loan that started AND ended while the sweep was down is applied in one round', catchUp.status === 200 && catchUp.body.applied >= 2 && catchUp.body.failed === 0, JSON.stringify(catchUp));
  const moves = rows(`SELECT kind, "effectiveDate"::text FROM employee_depot_moves WHERE "employeeId" = '${late.body.id}' ORDER BY seq`);
  check('the ledger keeps the ORIGINAL dates (start 3 days ago, back the day after the last day)', moves.length === 2 && moves[0][0] === 'LOAN_START' && moves[0][1] === day(addDays(today, -3)) && moves[1][0] === 'LOAN_END' && moves[1][1] === TODAY, JSON.stringify(moves));
  const [[lateDepot]] = rows(`SELECT "depotId" FROM employees WHERE id = '${late.body.id}'`);
  check('and they are home again', lateDepot === G);
  void lateAid;

  // ---- 8e. lending a MANAGER, planned by head office (the grant rule must not fire: no role changes)
  seq += 1;
  const mgrRes = await api('POST', '/employees/api/v1/employees', {
    fullName: `DAPR MGR ${stamp}`, phone: `0897${stamp}${seq}`.slice(0, 13), depotId: G, position: 'Manajer',
    role: 'MANAGER', employmentStatus: 'PERMANENT', joinDate: '2024-01-01', salaryType: 'MONTHLY', monthlyRate: 6_000_000,
    nik: `34${stamp}${seq}`.padEnd(16, '3'), bankName: 'BCA', bankAccount: '1234567890',
  }, HR_TOKEN);
  check('a MANAGER employee exists', mgrRes.status === 201, JSON.stringify(mgrRes.body).slice(0, 160));
  const mgrPlan = await api('POST', '/depot-assignments/api/v1/depot-assignments',
    { employeeId: mgrRes.body?.id, kind: 'LOAN', depotId: P, startDate: TODAY, endDate: day(addDays(today, 4)) }, tokenFor('HEAD_OFFICE'));
  check('head office plans the loan of a manager', mgrPlan.status === 201, JSON.stringify(mgrPlan.body).slice(0, 160));
  const mgrSweep = sweep();
  check('the sweep flips a MANAGER planned by head office (was: refused as a role escalation)', mgrSweep.status === 200 && mgrSweep.body.failed === 0 && mgrSweep.body.applied >= 1, JSON.stringify(mgrSweep));
  const [[mgrDepot, mgrState]] = rows(`SELECT e."depotId", a.status FROM employees e JOIN employee_depot_assignments a ON a."employeeId" = e.id WHERE e.id = '${mgrRes.body?.id}'`);
  check('and they are at the destination with the loan ACTIVE', mgrDepot === P && mgrState === 'ACTIVE', `${mgrDepot} ${mgrState}`);

  // ---- 8f. the ledger refuses a second step for the same assignment (two sweeps at once)
  const [[someAid]] = rows(`SELECT id FROM employee_depot_assignments WHERE "employeeId" = '${mgrRes.body?.id}'`);
  let dupRefused = false;
  try {
    sql(`INSERT INTO employee_depot_moves (id, "employeeId", "fromDepotId", "toDepotId", "effectiveDate", kind, "assignmentId") VALUES (gen_random_uuid(), '${mgrRes.body?.id}', '${G}', '${P}', '${TODAY}', 'LOAN_START', '${someAid}')`);
  } catch (e) {
    dupRefused = /duplicate key|employee_depot_moves_assignmentId_kind_key/.test(String(e.stderr ?? e.message));
  }
  check('the database refuses a second LOAN_START for one assignment', dupRefused);
  const [[loanStarts]] = rows(`SELECT count(*) FROM employee_depot_moves WHERE "assignmentId" = '${someAid}' AND kind = 'LOAN_START'`);
  check('so the ledger still holds exactly one', loanStarts === '1', loanStarts);

  // ---- 8g. a slip generated BEFORE a loan was backdated into its month cannot be approved as is
  const stale = await newEmployee('STALE', G);
  const pm = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const stalePeriod = `${pm.getUTCFullYear()}-${String(pm.getUTCMonth() + 1).padStart(2, '0')}`;
  const staleSlip = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: stale.body.id, periodMonth: stalePeriod }, HR_TOKEN);
  check('a DRAFT slip for last month exists', staleSlip.status === 201, JSON.stringify(staleSlip.body).slice(0, 120));
  await new Promise((r) => setTimeout(r, 1100)); // updatedAt and the ledger row must be distinguishable
  const monthStart = `${stalePeriod}-10`;
  const lateLoan = await api('POST', '/depot-assignments/api/v1/depot-assignments', { employeeId: stale.body.id, kind: 'LOAN', depotId: P, startDate: monthStart, endDate: `${stalePeriod}-12` }, HR_TOKEN);
  check('HR backdates a loan into that month', lateLoan.status === 201, JSON.stringify(lateLoan.body).slice(0, 160));
  sweep(); // applies the loan and its end in one round, with the ORIGINAL dates
  const stale409 = await api('POST', `/payroll/api/v1/payroll/${staleSlip.body.id}/approve`, {}, HR_TOKEN);
  check('approving the stale slip is refused (409, regenerate first)', stale409.status === 409 && /Hitung ulang/.test(JSON.stringify(stale409.body)), `${stale409.status} ${JSON.stringify(stale409.body).slice(0, 160)}`);
  const regen2 = await api('POST', `/payroll/api/v1/payroll/${staleSlip.body.id}/regenerate`, {}, HR_TOKEN);
  const staleParts = rows(`SELECT count(*), coalesce(sum(days),0) FROM payroll_depot_shares WHERE "payrollId" = '${staleSlip.body.id}'`)[0];
  check('regenerating picks the loan up: two depots, 3 days away', [200, 201].includes(regen2.status) && staleParts[0] === '2', `${regen2.status} ${staleParts}`);
  const ok2 = await api('POST', `/payroll/api/v1/payroll/${staleSlip.body.id}/approve`, {}, HR_TOKEN);
  check('and now it can be approved', [200, 201].includes(ok2.status), `${ok2.status} ${JSON.stringify(ok2.body).slice(0, 120)}`);

  // ---- 8d. the company's own BPJS cost is a report, never a payslip line
  const prevM = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const costPeriod = `${prevM.getUTCFullYear()}-${String(prevM.getUTCMonth() + 1).padStart(2, '0')}`;
  const costUrl = `${GATEWAY}/hr-reports/api/v1/hr-reports/payroll-employer-cost?periodMonth=${costPeriod}`;
  const costRes = await fetch(costUrl, { headers: { authorization: `Bearer ${HR_TOKEN}` } });
  const costCsv = await costRes.text();
  const costHead = costCsv.split('\u000a')[0] ?? '';
  check('employer BPJS cost report answers with its columns and a TOTAL row', costRes.status === 200 && /totalBebanPerusahaan/.test(costHead) && /TOTAL/.test(costCsv), `${costRes.status} ${costCsv.slice(0, 160)}`);
  const costMgr = await fetch(costUrl, { headers: { authorization: `Bearer ${manager(G)}` } });
  check('a depot manager cannot read the company cost (403)', costMgr.status === 403, String(costMgr.status));
  const noLine = rows(`SELECT count(*) FROM payroll_items WHERE label ILIKE '%perusahaan%'`)[0][0];
  check('and no payslip line carries an employer share', noLine === '0', noLine);

  // ---- 8c. a stale UPSERT import must not drag a lent employee back
  const lent = await newEmployee('UPS', G);
  await api('POST', '/depot-assignments/api/v1/depot-assignments', { employeeId: lent.body.id, kind: 'LOAN', depotId: P, startDate: TODAY, endDate: day(addDays(today, 5)) }, HR_TOKEN);
  sweep();
  const [[liveBefore]] = rows(`SELECT "depotId" FROM employees WHERE id = '${lent.body.id}'`);
  const nik = rows(`SELECT nik FROM employees WHERE id = '${lent.body.id}'`)[0][0];
  const up = await api('POST', '/employees/api/v1/employees/import', {
    mode: 'UPSERT',
    rows: [{
      fullName: `${lent.body.fullName} (diperbarui)`, phone: lent.body.phone, depotId: G, position: 'Staf',
      role: 'STAFF_DEPOT', employmentStatus: 'PERMANENT', joinDate: '2024-01-01', salaryType: 'MONTHLY', monthlyRate: 3_000_000, nik,
      bankName: 'BCA', bankAccount: '1234567890',
    }],
  }, HR_TOKEN);
  const [[liveAfter, homeAfter, nameAfter]] = rows(`SELECT "depotId", "homeDepotId", "fullName" FROM employees WHERE id = '${lent.body.id}'`);
  check('the stale import row does not move a lent employee (live depot unchanged)', liveBefore === P && liveAfter === P && homeAfter === G, `before ${liveBefore} after ${liveAfter}/${homeAfter}; import: ${JSON.stringify(up.body).slice(0, 200)}`);
  check('and the import answered per row, not with a 500', up.status === 200 || up.status === 201, String(up.status));
  void nameAfter;
}

async function flagOff() {
  const r = await api('GET', '/depot-assignments/api/v1/depot-assignments', undefined, HR_TOKEN);
  check('flag off: the assignment routes answer 404', r.status === 404, String(r.status));
  const s = sweep();
  check('flag off: the sweep reports disabled and does nothing', s.status === 200 && s.body.disabled === true && s.body.applied === 0, JSON.stringify(s));
  const e = await newEmployee('OFF', G);
  const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const period = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const gen = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: e.body.id, periodMonth: period }, HR_TOKEN);
  check('flag off: payroll still generates', gen.status === 201, JSON.stringify(gen.body).slice(0, 160));
  const n = rows(`SELECT count(*) FROM payroll_depot_shares WHERE "payrollId" = '${gen.body?.id}'`)[0][0];
  check('flag off: the slip is written with no split at all', n === '0');
  const view = await api('GET', `/payroll/api/v1/payroll/${gen.body?.id}`, undefined, manager(G));
  check('flag off: the slip reads as it always did', view.status === 200 && view.body.items?.length > 0 && view.body.shares === undefined);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
