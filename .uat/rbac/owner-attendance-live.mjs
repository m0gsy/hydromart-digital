// Live check that a franchise owner reads attendance at THEIR OWN depots and nothing else, against
// the running prod-like stack, through the gateway. Fixture: two real owners (scripts/seed.mjs),
// two depots they own, two employees moved there for the run and attendance rows written by SQL.
// Everything is put back at the end.
//
//   node .uat/rbac/owner-attendance-live.mjs
import { execSync } from 'node:child_process';
import { api, mintToken } from '../lib.mjs';

let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sql = (db, q) =>
  execSync(`docker exec -i hydromart-postgres psql -U hydromart -d ${db} -At`, { input: q, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAGO = '79425d58-b76c-41ee-909c-40f11c53842c'; // owns BDG-01
const GUBENG = 'fb3b94e6-bfd5-4b90-a9d2-a22141a76b3a'; // owns SBY-01
const NO_DEPOTS = 'd58a1d73-6029-4e99-b214-29df94bf6b05'; // an owner with no depot
const BDG = '020db071-25f6-426a-9dfb-f3cc9a395995';
const SBY = '9f9e99cd-9732-4b7b-b2e0-df82d8055d41';
const tok = (role, sub) => mintToken(role, { sub });
const O = (path, token) => api('GET', `/attendance/api/v1/attendance/owner${path}`, { token });

const emps = sql('hydromart_hr', 'select id, "depotId" from employees order by id limit 2').split('\n').map((l) => l.split('|'));
const [[E1, E1_DEPOT], [E2, E2_DEPOT]] = emps;
const ROWS = [];
let ok = false;

async function main() {
  // ---- fixture ------------------------------------------------------------------------------
  sql('hydromart_hr', `update employees set "depotId"='${BDG}' where id='${E1}'; update employees set "depotId"='${SBY}' where id='${E2}';`);
  const ins = (depot, emp, day, status, late, photo) => {
    const id = crypto.randomUUID();
    ROWS.push(id);
    sql(
      'hydromart_hr',
      `insert into attendance (id, "employeeId", "depotId", "workDate", "checkInAt", "checkOutAt", "checkInPhotoUrl", "checkInScore", "lateMinutes", status, "createdAt", "updatedAt")
       values ('${id}','${emp}','${depot}','${day}', '${day} 01:00', '${day} 10:00', ${photo ? `'${photo}'` : 'null'}, ${photo ? 0.93 : 'null'}, ${late}, '${status}', now(), now())`,
    );
    return id;
  };
  const bdgPresent = ins(BDG, E1, '2026-09-01', 'PRESENT', 0, 'hr/attendance/none.jpg');
  ins(BDG, E1, '2026-09-02', 'LATE', 12, null);
  ins(BDG, E1, '2026-09-03', 'ABSENT', 0, null);
  const sbyRow = ins(SBY, E2, '2026-09-01', 'PRESENT', 0, 'hr/attendance/none.jpg');
  ins(SBY, E2, '2026-09-02', 'LATE', 30, null);
  const WIN = 'from=2026-09-01&to=2026-09-30&pageSize=100';

  // ---- who owns what -------------------------------------------------------------------------
  let r = await O('/depots', tok('FRANCHISE_OWNER', DAGO));
  check('owner Dago sees exactly the depot they own', r.status === 200 && r.body.length === 1 && r.body[0].id === BDG, `status ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
  r = await O('/depots', tok('FRANCHISE_OWNER', GUBENG));
  check('owner Gubeng sees theirs, not Dago', r.status === 200 && r.body.length === 1 && r.body[0].id === SBY);

  // ---- the log ---------------------------------------------------------------------------------
  r = await O(`?${WIN}`, tok('FRANCHISE_OWNER', DAGO));
  const dagoRows = r.body?.rows ?? [];
  check('Dago reads their 3 rows', r.status === 200 && dagoRows.length === 3 && r.body.total === 3, `status ${r.status} total ${r.body?.total}`);
  check('and every row is at their depot', dagoRows.length > 0 && dagoRows.every((x) => x.depotId === BDG));
  check('rows carry the employee name', dagoRows.every((x) => typeof x.employeeName === 'string'));
  r = await O(`?${WIN}`, tok('FRANCHISE_OWNER', GUBENG));
  check('Gubeng reads only their 2', r.status === 200 && r.body.total === 2 && r.body.rows.every((x) => x.depotId === SBY), `total ${r.body?.total}`);
  r = await O(`?${WIN}&status=LATE`, tok('FRANCHISE_OWNER', DAGO));
  check('the status filter narrows it', r.status === 200 && r.body.total === 1 && r.body.rows[0].lateMinutes === 12);

  r = await O(`?${WIN}&depotId=${SBY}`, tok('FRANCHISE_OWNER', DAGO));
  check("naming another owner's depot is refused (403)", r.status === 403, `status ${r.status}`);
  r = await O(`?${WIN}&depotId=${BDG}`, tok('FRANCHISE_OWNER', DAGO));
  check('naming their own depot works (control)', r.status === 200 && r.body.total === 3);

  // ---- the summary -----------------------------------------------------------------------------
  r = await O('/summary?from=2026-09-01&to=2026-09-30', tok('FRANCHISE_OWNER', DAGO));
  const d = r.body?.depots?.[0];
  check('Dago summary: one depot, exact counts', r.status === 200 && r.body.depots.length === 1 && d.depotId === BDG && d.present === 1 && d.late === 1 && d.absent === 1 && d.lateMinutes === 12 && d.employees === 1, JSON.stringify(d));
  r = await O(`/summary?from=2026-09-01&to=2026-09-30&depotId=${SBY}`, tok('FRANCHISE_OWNER', DAGO));
  check("summary for someone else's depot is refused", r.status === 403, `status ${r.status}`);
  r = await O('/summary?from=2026-09-01', tok('FRANCHISE_OWNER', DAGO));
  check('a summary needs a window (400)', r.status === 400, `status ${r.status}`);

  // ---- photos ------------------------------------------------------------------------------------
  r = await O(`/${bdgPresent}/photo/in`, tok('FRANCHISE_OWNER', DAGO));
  // The object itself is not in this stack's bucket (and local storage may be off: 503). What matters is
  // that an OWN row gets past the access check, so it never answers the not-found words a foreign row gets.
  check('own row: access passes (it fails later, at the storage step)', [404, 503].includes(r.status) && !/Data absensi tidak ditemukan/.test(JSON.stringify(r.body)), `status ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  r = await O(`/${sbyRow}/photo/in`, tok('FRANCHISE_OWNER', DAGO));
  check("someone else's row is indistinguishable from a missing one", r.status === 404 && /Data absensi tidak ditemukan/.test(JSON.stringify(r.body)), `status ${r.status}`);
  r = await O(`/${crypto.randomUUID()}/photo/in`, tok('FRANCHISE_OWNER', DAGO));
  check('a row that does not exist answers the same words', r.status === 404 && /Data absensi tidak ditemukan/.test(JSON.stringify(r.body)));
  r = await O(`/${bdgPresent}/photo/sideways`, tok('FRANCHISE_OWNER', DAGO));
  check('only in/out are photo sides (400)', r.status === 400);

  // ---- nobody else, and nothing wider --------------------------------------------------------------
  for (const role of ['HEAD_OFFICE', 'MANAGER', 'HR', 'FINANCE', 'DIREKTUR']) {
    r = await O(`?${WIN}`, tok(role, crypto.randomUUID()));
    check(`${role} cannot use the owner routes`, r.status === 403, `status ${r.status}`);
  }
  r = await api('GET', `/attendance/api/v1/attendance?${WIN}`, { token: tok('FRANCHISE_OWNER', DAGO) });
  check('an owner is still refused the HR attendance list (all depots)', r.status === 403, `status ${r.status}`);
  r = await api('GET', `/attendance/api/v1/attendance/${bdgPresent}/photo/in`, { token: tok('FRANCHISE_OWNER', DAGO) });
  check('and the HR photo route', r.status === 403, `status ${r.status}`);
  r = await api('GET', `/attendance/api/v1/attendance?${WIN}`, { token: tok('HEAD_OFFICE', crypto.randomUUID()) });
  check('HR attendance still works for head office (control)', r.status === 200 && r.body.total >= 5, `status ${r.status} total ${r.body?.total}`);

  r = await O(`?${WIN}`, tok('SUPER_ADMIN', crypto.randomUUID()));
  check('a super admin has no depots here, so reads nothing (not everything)', r.status === 200 && r.body.total === 0, `total ${r.body?.total}`);
  r = await O(`?${WIN}`, tok('FRANCHISE_OWNER', NO_DEPOTS));
  check('an owner with no depot reads nothing (not everything)', r.status === 200 && r.body.total === 0 && r.body.rows.length === 0, `total ${r.body?.total}`);
  r = await O('/summary?from=2026-09-01&to=2026-09-30', tok('FRANCHISE_OWNER', NO_DEPOTS));
  check('and an empty summary', r.status === 200 && r.body.depots.length === 0);

  // ---- /auth/me advertises the capability to owners only -------------------------------------------
  const me = await api('GET', '/auth/api/v1/auth/me', { token: tok('FRANCHISE_OWNER', DAGO) });
  check('/auth/me lists hrViewOwn for an owner', me.status === 200 && me.body.capabilities.includes('hrViewOwn') && !me.body.capabilities.includes('hrView'), `status ${me.status}`);
  const ho = await api('GET', '/auth/api/v1/auth/me', { token: tok('HEAD_OFFICE', '78f6b901-224d-4b4c-97fa-d59ba9036dde') });
  check('and not for head office', ho.status === 200 && !ho.body.capabilities.includes('hrViewOwn'), `status ${ho.status}`);

  // ---- fail closed when depot-service is down -----------------------------------------------------------
  execSync('docker stop hydromart-depot-1', { stdio: 'ignore' });
  try {
    await sleep(2000);
    r = await O(`?${WIN}`, tok('FRANCHISE_OWNER', DAGO));
    check('with depot-service down the owner gets 503, never the whole network', r.status === 503, `status ${r.status}`);
  } finally {
    execSync('docker start hydromart-depot-1', { stdio: 'ignore' });
    for (let i = 0; i < 40; i += 1) {
      await sleep(3000);
      if ((await O('/depots', tok('FRANCHISE_OWNER', DAGO))).status === 200) break;
    }
  }
  r = await O(`?${WIN}`, tok('FRANCHISE_OWNER', DAGO));
  check('and recovers when it is back', r.status === 200 && r.body.total === 3, `status ${r.status}`);
  ok = true;
}

main()
  .catch((e) => {
    console.error(e);
    failed += 1;
  })
  .finally(() => {
    // Put everything back, whatever happened above.
    try {
      if (ROWS.length) sql('hydromart_hr', `delete from attendance where id in (${ROWS.map((x) => `'${x}'`).join(',')})`);
      sql('hydromart_hr', `update employees set "depotId"=${E1_DEPOT ? `'${E1_DEPOT}'` : 'null'} where id='${E1}'; update employees set "depotId"=${E2_DEPOT ? `'${E2_DEPOT}'` : 'null'} where id='${E2}';`);
    } catch (e) {
      console.error('cleanup failed', e);
      failed += 1;
    }
    console.log(`\n${total - failed}/${total} passed${failed ? `, ${failed} FAILED` : ''}${ok ? '' : ' (run aborted early)'}`);
    process.exit(failed ? 1 : 0);
  });
