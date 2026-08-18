// Fills the work queues the UAT script expects to find already populated.
//
// A third of the Blocked results in the 2026-07-27 sweep were not defects: the case says
// "approve a pending X" and the queue is empty, because nothing in the run ever files an
// X. Provision them the same way run.mjs provisions stock, drivers and gallons — through
// the real product API wherever one exists, and by SQL insert only for the few tables the
// release genuinely has no write path for (support tickets, feature flags, retention
// policies, franchise revenue). Those four are flagged in the console output so the gap
// stays visible instead of being papered over.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { api, internalApi } from './lib.mjs';

const D = '/depots/api/v1';
const PAYOUT = '/payout/api/v1';
const DEL = '/deliveries/api/v1';
const L = '/loyalty/api/v1';

// Both thresholds come from the service defaults (APPROVAL_AUTO_PASS_IDR=100000,
// EXPENSE_AUTO_APPROVE_MAX_IDR=50000). Seed above them or the item auto-decides itself
// and the queue is still empty.
const APPROVAL_AMOUNT = -250_000;
const EXPENSE_AMOUNT = 150_000;

const PG = 'hydromart-postgres';

/** One-shot SQL against a service database inside the postgres container. */
function sql(db, statement) {
  const r = spawnSync('docker', ['exec', PG, 'psql', '-U', 'hydromart', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    encoding: 'utf8', shell: false, maxBuffer: 10e6,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, out: out.split('\n').slice(-2).join(' ') };
}

export async function seedQueues(ctx) {
  const notes = [];
  const depot = ctx.depotA;

  // -------------------------------------------------- depot approval queue (M8-04/12, M26-02/08)
  // Three PENDING items: M8-04 decides one, M26-02 decides another, M8-12 re-decides the
  // first to prove ALREADY_DECIDED.
  let approvals = 0;
  for (const [type, title] of [
    ['OPNAME_VARIANCE', 'Selisih opname galon 19L'],
    ['DEPOSIT_REFUND', 'Refund deposit galon pelanggan'],
    ['COD_VARIANCE', 'Selisih setoran COD kurir'],
  ]) {
    const r = await api('POST', `${D}/approvals`, {
      token: ctx.manager,
      body: { depotId: depot.id, type, title, subjectRef: 'UAT seed', amountIdr: APPROVAL_AMOUNT, payload: { seededBy: 'uat' } },
    });
    if (r.status < 400 && r.body?.status === 'PENDING') approvals += 1;
    else if (r.status >= 400) notes.push(`approval seed HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }

  // -------------------------------------------------- courier expense claims (M20-04/16)
  let expenses = 0;
  for (const [category, description] of [
    ['FUEL', 'Bensin motor shift pagi'],
    ['PARKING_TOLL', 'Parkir dan tol antar galon'],
  ]) {
    const r = await api('POST', `${PAYOUT}/courier/expenses`, {
      token: ctx.driverA,
      body: { category, amount: EXPENSE_AMOUNT, description, depotId: depot.id },
    });
    if (r.status < 400 && r.body?.status === 'PENDING') expenses += 1;
    else if (r.status >= 400) notes.push(`expense seed HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }

  // -------------------------------------------------- commission schemes (M20-10)
  // The case reads the scheme list and then applies a new one, so it can never run on a
  // network that has never had one applied. Apply the first one here.
  const scheme = await api('POST', `${PAYOUT}/commission/schemes/apply`, {
    token: ctx.finance,
    body: { effectiveDate: new Date(Date.now() - 86400e3).toISOString().slice(0, 10), items: [{ depotId: depot.id, ownerName: 'UAT seed', pct: 4 }] },
  });
  if (scheme.status >= 400) notes.push(`commission seed HTTP ${scheme.status}`);

  // -------------------------------------------------- courier earning rule (M20-02/13)
  // recordDeliveryEarning skips silently when the depot has no rule ("No courier earning
  // rule for depot …"), so the seeded delivery below would credit nothing without this.
  const rule = await api('POST', `${PAYOUT}/courier-earning-rules`, {
    token: ctx.finance,
    body: {
      depotId: depot.id, baseFare: 5000, peakBonus: 2000, onTimeBonus: 1000,
      peakStartHour: 17, peakEndHour: 20,
      effectiveDate: new Date(Date.now() - 86400e3).toISOString().slice(0, 10),
    },
  });
  if (rule.status >= 400) notes.push(`earning rule seed HTTP ${rule.status} ${JSON.stringify(rule.body).slice(0, 120)}`);

  // -------------------------------------------------- courier earnings balance (M20-02/13)
  // Earnings are posted by delivery-service over the internal key on every completed
  // delivery. The gateway strips that header by design (SEC-4), so post it from inside
  // the payout container the way the scheduler does.
  let earnings = { status: 0 };
  if (ctx.driverAId) {
    earnings = await internalApi('hydromart-payout-1', 3016, '/api/v1/courier/ledger/internal', {
      body: {
        courierId: ctx.driverAId,
        depotId: depot.id,
        deliveryId: crypto.randomUUID(),
        deliveredAt: new Date().toISOString(),
        onTime: true,
      },
    });
    if (earnings.status >= 400 || earnings.status === 0) notes.push(`courier earning seed: ${JSON.stringify(earnings).slice(0, 140)}`);
  }

  // -------------------------------------------------- HR bonus rule (M24-07)
  const bonus = await api('POST', '/hr/api/v1/bonus-rules', {
    token: ctx.hr,
    body: {
      bonusType: 'ATTENDANCE', name: 'Bonus kehadiran penuh UAT', metric: 'ATTENDANCE_RATE',
      op: 'GTE', threshold: 95, rewardKind: 'FIXED', rewardValue: 200000, active: true,
    },
  });
  if (bonus.status >= 400) notes.push(`bonus rule seed HTTP ${bonus.status} ${JSON.stringify(bonus.body).slice(0, 120)}`);

  // -------------------------------------------------- fraud flag queue (M23-03)
  const fraud = await internalApi('hydromart-admin-1', 3017, '/api/v1/fraud-flags/internal', {
    body: {
      entityType: 'ORDER',
      entityRef: `ORD-UAT-${Math.floor(Math.random() * 9000 + 1000)}`,
      score: 82,
      level: 'HIGH',
      signals: ['Nilai jauh di atas rata-rata', 'Alamat baru'],
    },
  });
  if (fraud.status >= 400 || fraud.status === 0) notes.push(`fraud flag seed: ${JSON.stringify(fraud).slice(0, 140)}`);

  // -------------------------------------------------- driver on shift (M16-03) + settlement (M20-06/07)
  // Driver A stays checked in so delivery assignment stops failing DELIVERY_DRIVER_NOT_ON_SHIFT.
  // Driver B does a full check-in/check-out/deposit so the depot has an unverified settlement.
  // Check-in is verified against the depot's own coordinates, so use them verbatim.
  const at = { lat: Number(depot.latitude ?? depot.lat ?? -6.2), lng: Number(depot.longitude ?? depot.lng ?? 106.8) };
  const checkIn = async (token) => api('POST', `${DEL}/driver/shifts/check-in`, {
    token, body: { depotId: depot.id, ...at },
  });
  const shiftA = await checkIn(ctx.driverA);
  if (shiftA.status >= 400 && shiftA.status !== 409) notes.push(`driver A check-in HTTP ${shiftA.status} ${JSON.stringify(shiftA.body).slice(0, 120)}`);
  ctx.driverAShift = shiftA.body?.id ? shiftA.body : (await api('GET', `${DEL}/driver/shifts/current`, { token: ctx.driverA })).body;

  let settlement = { status: 0 };
  const shiftB = await checkIn(ctx.driverB);
  const shiftBId = shiftB.body?.id ?? (await api('GET', `${DEL}/driver/shifts/current`, { token: ctx.driverB })).body?.id;
  if (shiftBId) {
    await api('POST', `${DEL}/driver/shifts/${shiftBId}/check-out`, { token: ctx.driverB, body: at });
    settlement = await api('POST', `${DEL}/driver/settlement`, { token: ctx.driverB, body: { shiftId: shiftBId, depositedAmount: 0 } });
    if (settlement.status >= 400) notes.push(`settlement seed HTTP ${settlement.status} ${JSON.stringify(settlement.body).slice(0, 120)}`);
  }

  // -------------------------------------------------- SQL-only seeds
  // No release endpoint writes these four tables, so the UAT cases that decide on them can
  // only run against inserted rows. Each one is a real coverage gap worth reporting.
  const gaps = [];
  const flags = sql('hydromart_admin', `INSERT INTO feature_flags ("id","key","label","description","state","updatedAt") VALUES
    ('${crypto.randomUUID()}','uat_langganan_baru','Langganan baru','Alur langganan versi baru','OFF',NOW()),
    ('${crypto.randomUUID()}','uat_peta_kurir','Peta kurir','Pelacakan kurir di peta','ACTIVE',NOW())
    ON CONFLICT ("key") DO NOTHING;`);
  if (!flags.ok) notes.push(`feature flag seed: ${flags.out}`);
  gaps.push('feature-flags: no create endpoint (PATCH :key only)');

  const retention = sql('hydromart_admin', `INSERT INTO retention_policies ("id","dataset","windowLabel","windowDays","updatedAt") VALUES
    ('${crypto.randomUUID()}','pesanan','7 tahun (UU PDP)',2555,NOW()),
    ('${crypto.randomUUID()}','log_audit','2 tahun',730,NOW())
    ON CONFLICT ("dataset") DO NOTHING;`);
  if (!retention.ok) notes.push(`retention seed: ${retention.out}`);
  gaps.push('retention-policies: no create endpoint (PUT :id only)');

  const ticketId = crypto.randomUUID();
  const ticket = sql('hydromart_admin', `INSERT INTO support_tickets ("id","subject","customerRef","customerPhone","priority","status") VALUES
    ('${ticketId}','Galon bocor saat diterima','UAT Customer A','${ctx.customerAPhone ?? '+628120000000'}','HIGH','OPEN');
    INSERT INTO ticket_messages ("id","ticketId","authorType","body") VALUES
    ('${crypto.randomUUID()}','${ticketId}','CUSTOMER','Galon yang diantar tadi bocor, mohon diganti.');`);
  if (!ticket.ok) notes.push(`ticket seed: ${ticket.out}`);
  gaps.push('support-tickets: no intake endpoint anywhere — staff can only read/reply/assign/resolve');

  // No depot in this environment has a franchise owner, so nothing a completed order posts
  // would land anywhere. Stamp one on depot A and let the real path (order COMPLETED ->
  // payout revenue/internal) fill the HQ release queue during the sweep.
  const ownerId = ctx.franchiseOwnerSeedId ?? '33333333-0000-4000-a000-000000000001';
  const owner = await api('PATCH', `${D}/depots/${depot.id}`, { token: ctx.admin, body: { ownerId } });
  if (owner.status >= 400) notes.push(`depot owner seed HTTP ${owner.status} ${JSON.stringify(owner.body).slice(0, 120)}`);
  else ctx.franchiseOwnerId = ownerId;

  console.log(`seed: ${approvals} approvals, ${expenses} expense claims, scheme HTTP ${scheme.status}, earning HTTP ${earnings.status}, fraud HTTP ${fraud.status}, settlement HTTP ${settlement.status}, points ${ctx.pointsBalance ?? 'n/a'}`);
  for (const n of notes) console.log(`  WARN ${n}`);
  for (const g of gaps) console.log(`  GAP  ${g}`);
}

/**
 * Points balance for the reward cases (M9-02/12). Runs after m01 because that module is
 * where customer A is registered. M9-12 needs a balance that affords exactly one of the
 * cheapest reward and not two, so read the catalogue instead of guessing a number.
 */
export async function seedPoints(ctx) {
  if (!ctx.customerAId) return;
  const cat = await api('GET', `${L}/rewards/catalog`);
  const items = (Array.isArray(cat.body) ? cat.body : cat.body?.items ?? [])
    .filter((x) => (x.pointsCost ?? x.points) > 0 && (x.stock ?? 1) > 0);
  const cheapest = items.length ? Math.min(...items.map((x) => x.pointsCost ?? x.points)) : 500;
  // 2.5x: M9-02 redeems one (leaving 1.5x), which is what M9-12's single-redeem race needs.
  const target = Math.floor(cheapest * 2.5);
  const me = await api('GET', `${L}/loyalty/customers/${ctx.customerAId}`, { token: ctx.admin });
  const current = me.body?.balance ?? me.body?.pointsBalance ?? 0;
  ctx.pointsBalance = current;
  if (target === current) return;
  const adj = await api('POST', `${L}/loyalty/adjust`, {
    token: ctx.admin,
    body: { customerId: ctx.customerAId, points: target - current, reason: 'Saldo awal UAT untuk kasus penukaran hadiah' },
  });
  if (adj.status >= 400) console.log(`  WARN points seed HTTP ${adj.status} ${JSON.stringify(adj.body).slice(0, 120)}`);
  else { ctx.pointsBalance = target; console.log(`seed: points balance ${current} -> ${target} (cheapest reward ${cheapest})`); }
}
