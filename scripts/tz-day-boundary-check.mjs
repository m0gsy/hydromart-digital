// Butir 16 — an order placed at 00:30 WIB belongs to THAT day's report, not the previous
// one. Driven over real HTTP against a running stack.
//
//   JWT_ACCESS_SECRET=<the stack's secret> node scripts/tz-day-boundary-check.mjs
//
// This is the one check a unit test cannot stand in for. The C2 fix is a SQL day boundary
// (`dayStartUtc(day, tz)` / `AT TIME ZONE 'UTC' AT TIME ZONE tz`), so it is only true when
// the service, the query and the database all agree — and the failure it prevents is
// invisible at any hour except the seven between midnight and 07:00 WIB.
//
// Method: an existing order's `createdAt` is moved to 00:30 WIB (= 17:30 UTC the previous
// day), then both days' reports are asked about it. The naive UTC boundary files it under
// the PREVIOUS day; the correct one does not. The original timestamp is restored at the end.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
//   PSQL_CONTAINER      default hydromart-postgres
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const PG = process.env.PSQL_CONTAINER ?? 'hydromart-postgres';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(role, depotId = null) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: crypto.randomUUID(), role, phone: '+620000000000', depotId, iat: now, exp: now + 3600 })}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}

const sql = (db, statement) =>
  execFileSync('docker', ['exec', PG, 'psql', '-U', 'hydromart', '-d', db, '-tAc', statement], {
    encoding: 'utf8',
  }).trim();

async function report(depotId, date, token) {
  const res = await fetch(
    `${GATEWAY}/orders/api/v1/reports/depot-daily?depotId=${depotId}&date=${date}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, d) => {
  console.log(`  FAIL ${m}`);
  if (d !== undefined) console.log(`       ${typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)}`);
  failures++;
};

/** Orders count for a day, whatever the report calls the field. */
// `orders` is a COUNT in this payload, not an array — read from the live response rather
// than guessed. Kept tolerant of the other shapes so a rename fails loudly instead of
// silently reading `undefined` as zero.
const countOf = (body) =>
  typeof body?.orders === 'number'
    ? body.orders
    : (body?.orderCount ?? body?.totalOrders ?? body?.summary?.orderCount ?? null);

async function main() {
  console.log(`tz day-boundary check against ${GATEWAY}\n`);

  const row = sql(
    'hydromart_order',
    `select id || '|' || "depotId" || '|' || "createdAt" from orders where "depotId" is not null order by "createdAt" desc limit 1`,
  );
  if (!row) {
    console.error('!! no order with a depot in the local database — seed one first.');
    process.exit(2);
  }
  const [orderId, depotId, originalCreatedAt] = row.split('|');
  console.log(`fixture order ${orderId}\n  depot ${depotId}\n  original createdAt ${originalCreatedAt} (UTC)\n`);

  // 00:30 on a WIB day that no other fixture is sitting on. Stored UTC, so 17:30 the day
  // before — the whole point: the calendar date in the column is NOT the business date.
  const WIB_DAY = '2026-03-10';
  const PREV_WIB_DAY = '2026-03-09';
  const AT_UTC = '2026-03-09 17:30:00'; // = 2026-03-10 00:30 WIB
  const token = tokenFor('SUPER_ADMIN');

  try {
    const before = await report(depotId, WIB_DAY, token);
    const beforePrev = await report(depotId, PREV_WIB_DAY, token);
    if (before.status !== 200 || beforePrev.status !== 200) {
      bad('depot-daily report is reachable', `status ${before.status}/${beforePrev.status}`);
      return;
    }
    const baseline = countOf(before.body);
    const baselinePrev = countOf(beforePrev.body);
    if (baseline === null) {
      bad('report shape understood', `no order count in ${JSON.stringify(before.body).slice(0, 200)}`);
      return;
    }

    sql('hydromart_order', `update orders set "createdAt" = '${AT_UTC}' where id = '${orderId}'`);

    const after = await report(depotId, WIB_DAY, token);
    const afterPrev = await report(depotId, PREV_WIB_DAY, token);
    const now = countOf(after.body);
    const nowPrev = countOf(afterPrev.body);

    if (now === baseline + 1) {
      ok(`an order at 00:30 WIB lands in ${WIB_DAY}'s report (${baseline} → ${now})`);
    } else {
      bad(`order at 00:30 WIB missing from ${WIB_DAY}`, `${baseline} → ${now}`);
    }

    // The half that fails with a naive UTC boundary: 17:30 UTC is still 2026-03-09 in UTC,
    // so a `date_trunc`-style query files this order under the PREVIOUS business day.
    if (nowPrev === baselinePrev) {
      ok(`and NOT in ${PREV_WIB_DAY}'s report (${baselinePrev} → ${nowPrev}) — the UTC boundary would have put it there`);
    } else {
      bad(`order leaked into ${PREV_WIB_DAY}`, `${baselinePrev} → ${nowPrev}`);
    }
  } finally {
    sql(
      'hydromart_order',
      `update orders set "createdAt" = '${originalCreatedAt}' where id = '${orderId}'`,
    );
    console.log(`\n  (fixture order restored to ${originalCreatedAt})`);
  }

  if (failures) {
    console.error(`\ntz day-boundary check: ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\ntz day-boundary check: all passed');
}

main().catch((e) => {
  console.error(`tz day-boundary check: ${e.message}`);
  process.exit(1);
});
