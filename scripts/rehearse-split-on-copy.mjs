// Rehearses the per-depot payroll split on a COPY of the production HR database.
//
//   1. restore the dump into the prod-like stack's hr database (see the header of
//      scripts/depot-assignment-flows.mjs for the stack), boot hr with the flag OFF
//   2. node scripts/rehearse-split-on-copy.mjs off     # generates every slip, saves the nets
//   3. boot hr with the flag ON
//   4. node scripts/rehearse-split-on-copy.mjs on      # regenerates, compares, adds loans, compares
//
// What it asserts, on REAL employees and rules:
//   - turning the flag on changes no employee's slip (gross, bonus, deduction, net);
//   - every slip then carries shares that add up to its net, exactly;
//   - lending a real employee for part of the month changes nothing in the TOTAL, only who
//     carries it, and the days are the calendar days of the loan.
//
// It only ever writes DRAFT slips and synthetic loan rows into the COPY. Never point it at
// production: it refuses a gateway that is not on localhost.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MODE = process.argv[2];
if (!['off', 'on'].includes(MODE)) {
  console.error('usage: node scripts/rehearse-split-on-copy.mjs off|on');
  process.exit(2);
}
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:18080';
if (!/localhost|127\.0\.0\.1/.test(GATEWAY)) {
  console.error('refusing: this writes slips, and only ever against a local copy');
  process.exit(2);
}
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'itest-shared-access-secret-0123456789abcdef';
const PG = process.env.PG_CONTAINER ?? 'dapr-postgres';
const STATE = process.env.REHEARSAL_STATE ?? './rehearsal-state.json';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: crypto.randomUUID(), role: 'HR', phone: '+620000000000', depotId: null, iss: 'hydromart-auth', aud: 'hydromart-api', iat: now, exp: now + 3600 })}`;
  return `${data}.${crypto.createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}
const HR = token();
async function api(method, path, body) {
  const r = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${HR}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}
const sql = (q) =>
  execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'hydromart', '-d', 'hydromart_hr', '-qtAXF|', '-c', q], { encoding: 'utf8' }).trim();
const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split('|'));

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ' - ' + detail}`); };

const now = new Date();
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const period = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
const dim = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate();
const m = (d) => `${period}-${String(d).padStart(2, '0')}`;

const staff = rows(`SELECT id, "employeeCode", "depotId", "homeDepotId" FROM employees WHERE status = 'ACTIVE' ORDER BY "employeeCode"`);
console.log(`copy has ${staff.length} active employees; period ${period}`);

async function generateAll() {
  const out = {};
  for (const [id, code] of staff) {
    // A slip already APPROVED/PAID for the month stays as it is: that IS the real number.
    const existing = rows(`SELECT status, net FROM payrolls WHERE "employeeId" = '${id}' AND "periodMonth" = '${period}'`)[0];
    if (existing && existing[0] !== 'DRAFT') { out[code] = { locked: true, net: Number(existing[1]) }; continue; }
    const r = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: id, periodMonth: period });
    if (r.status !== 201 && r.status !== 200) { out[code] = { error: `${r.status} ${JSON.stringify(r.body).slice(0, 120)}` }; continue; }
    const p = r.body;
    out[code] = { id: p.id, gross: Number(p.gross), bonus: Number(p.totalBonus), deduction: Number(p.totalDeduction), net: Number(p.net) };
  }
  return out;
}

(async () => {
  if (MODE === 'off') {
    const slips = await generateAll();
    writeFileSync(STATE, JSON.stringify({ period, slips }, null, 2));
    const ok = Object.values(slips).filter((s) => s.net !== undefined).length;
    const bad = Object.entries(slips).filter(([, s]) => s.error);
    check(`flag OFF: ${ok}/${staff.length} slips generated and saved as the baseline`, bad.length === 0, JSON.stringify(bad).slice(0, 300));
    const shares = rows(`SELECT count(*) FROM payroll_depot_shares`)[0][0];
    check('flag OFF: no slip carries a split', shares === '0', shares);
  } else {
    if (!existsSync(STATE)) { console.error('run `off` first'); process.exit(2); }
    const base = JSON.parse(readFileSync(STATE, 'utf8'));
    // Production has no assignments or moves (verified before the dump), so whatever is in the
    // copy is a previous rehearsal's. Start clean so the run is repeatable.
    sql(`DELETE FROM employee_depot_moves; DELETE FROM employee_depot_assignments;`);
    sql(`DELETE FROM attendance WHERE "createdAt" > now() - interval '1 day' AND status = 'PRESENT' AND "checkInAt" IS NULL`);
    check('same period as the baseline', base.period === period);
    const slips = await generateAll();

    // 1. the flag changes no number
    const diffs = [];
    for (const [code, b] of Object.entries(base.slips)) {
      const a = slips[code];
      if (!a || a.error || b.error) { if (!!a?.error !== !!b.error) diffs.push(`${code}: error mismatch`); continue; }
      if (b.locked || a.locked) { if (a.net !== b.net) diffs.push(`${code}: locked net ${b.net} -> ${a.net}`); continue; }
      for (const k of ['gross', 'bonus', 'deduction', 'net']) if (a[k] !== b[k]) diffs.push(`${code}: ${k} ${b[k]} -> ${a[k]}`);
    }
    check('flag ON changes no employee slip (gross, bonus, deduction, net)', diffs.length === 0, diffs.slice(0, 5).join('; '));

    // 2. every regenerated slip carries a split that adds up
    const [[unsplit]] = rows(`SELECT count(*) FROM payrolls p JOIN employees e ON e.id = p."employeeId" WHERE p."periodMonth" = '${period}' AND p.status = 'DRAFT' AND e."homeDepotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payroll_depot_shares s WHERE s."payrollId" = p.id)`);
    check('every DRAFT slip of somebody with a home depot now carries its shares', unsplit === '0', `${unsplit} without`);
    const [[hq]] = rows(`SELECT count(*) FROM employees e WHERE e.status = 'ACTIVE' AND e."homeDepotId" IS NULL`);
    console.log(`note: ${hq} active employee(s) have no home depot (head-office level); they carry no split by design`);
    const [[off]] = rows(`SELECT count(*) FROM payrolls p WHERE p."periodMonth" = '${period}' AND EXISTS (SELECT 1 FROM payroll_depot_shares s WHERE s."payrollId" = p.id) AND (SELECT sum(net) FROM payroll_depot_shares s WHERE s."payrollId" = p.id) <> p.net`);
    check('and each split adds back to its slip net exactly', off === '0', `${off} violations`);

    // 3. lend real employees for part of the month.
    //    MONTHLY pay is for the month, so the parts follow the calendar days of the loan and the
    //    TOTAL must not move. DAILY pay is for days worked, so the parts follow the attendance
    //    rows stamped at each depot.
    const depots = rows(`SELECT DISTINCT "depotId" FROM employees WHERE "depotId" IS NOT NULL`).map((r) => r[0]);
    const info = rows(`SELECT id, "employeeCode", "salaryType", "dailyRate"::int, "depotId" FROM employees WHERE status = 'ACTIVE' AND "depotId" IS NOT NULL ORDER BY "employeeCode"`);
    const monthly = info.filter((r) => r[2] === 'MONTHLY' && (slips[r[1]]?.gross ?? 0) > 0);
    const daily = info.filter((r) => r[2] === 'DAILY');
    check('the copy has MONTHLY and DAILY staff to lend', monthly.length > 0 && daily.length > 0, `${monthly.length}/${daily.length}`);

    for (const [i, [id, code, , , depotId]] of monthly.entries()) {
      const target = depots.find((d) => d !== depotId);
      const before = slips[code];
      const days = 6 + i * 4;
      const [[aid]] = rows(`INSERT INTO employee_depot_assignments (id, "employeeId", kind, "depotId", "startDate", "endDate", status, "updatedAt") VALUES (gen_random_uuid(), '${id}', 'LOAN', '${target}', '${m(10)}', '${m(10 + days - 1)}', 'DONE', now()) RETURNING id`);
      sql(`INSERT INTO employee_depot_moves (id, "employeeId", "fromDepotId", "toDepotId", "effectiveDate", kind, "assignmentId") VALUES (gen_random_uuid(), '${id}', '${depotId}', '${target}', '${m(10)}', 'LOAN_START', '${aid}'), (gen_random_uuid(), '${id}', '${target}', '${depotId}', '${m(10 + days)}', 'LOAN_END', '${aid}')`);
      const r = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: id, periodMonth: period });
      const parts = rows(`SELECT "depotId", days, gross, net FROM payroll_depot_shares WHERE "payrollId" = '${r.body?.id}'`);
      const away = parts.find((p) => p[0] === target);
      const home = parts.find((p) => p[0] === depotId);
      const sumNet = parts.reduce((a, p) => a + Number(p[3]), 0);
      const sumGross = parts.reduce((a, p) => a + Number(p[2]), 0);
      check(`${code} (MONTHLY): lent ${days} days -> slip totals unchanged`, ['gross', 'net'].every((k) => Number(r.body?.[k === 'gross' ? 'gross' : 'net']) === before[k]), JSON.stringify({ gross: r.body?.gross, net: r.body?.net, before }));
      check(`${code}: destination ${days} / home ${dim - days} calendar days`, Number(away?.[1]) === days && Number(home?.[1]) === dim - days, JSON.stringify(parts));
      check(`${code}: parts add to the slip (gross ${sumGross}, net ${sumNet})`, sumNet === Number(r.body?.net) && sumGross === Number(r.body?.gross));
    }

    for (const [i, [id, code, , rate, depotId]] of daily.slice(0, 3).entries()) {
      const target = depots.find((d) => d !== depotId);
      const away = 3 + i; // days worked at the destination
      const home = 4;     // days worked at home
      for (let d = 1; d <= home + away; d += 1) {
        const at = d <= home ? depotId : target;
        sql(`INSERT INTO attendance (id, "employeeId", "depotId", "workDate", status, "lateMinutes", "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${id}', '${at}', '${m(d)}', 'PRESENT', 0, now(), now()) ON CONFLICT ("employeeId", "workDate") DO NOTHING`);
      }
      const r = await api('POST', '/payroll/api/v1/payroll/generate', { employeeId: id, periodMonth: period });
      const parts = rows(`SELECT "depotId", days, gross, net FROM payroll_depot_shares WHERE "payrollId" = '${r.body?.id}'`);
      const aw = parts.find((p) => p[0] === target);
      const hm = parts.find((p) => p[0] === depotId);
      const sumNet = parts.reduce((a, p) => a + Number(p[3]), 0);
      const sumGross = parts.reduce((a, p) => a + Number(p[2]), 0);
      check(`${code} (DAILY): ${home} days home + ${away} days away -> gross is days x rate`, Number(r.body?.gross) === (home + away) * rate, `${r.body?.gross} vs ${(home + away) * rate}`);
      check(`${code}: the depots carry the days actually worked there (${home}/${away})`, Number(hm?.[1]) === home && Number(aw?.[1]) === away, JSON.stringify(parts));
      check(`${code}: gross ${sumGross} and net ${sumNet} add back to the slip`, sumGross === Number(r.body?.gross) && sumNet === Number(r.body?.net));
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
