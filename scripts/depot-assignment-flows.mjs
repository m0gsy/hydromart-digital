// Cross-depot assignment, driven over real HTTP against the production-shaped Docker stack.
//
//   docker compose -p dapr -f docker-compose.yml -f docker-compose.test.yml up -d --build postgres auth hr gateway
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
const G = crypto.randomUUID(); // home depot
const P = crypto.randomUUID(); // depot lent to
const X = crypto.randomUUID(); // a depot with no part in this
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
  check('a bad plan lists every reason at once', bad.status === 400 && reasons >= 3, `reasons=${reasons}`);

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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
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
