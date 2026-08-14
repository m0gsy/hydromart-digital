// Seed a running Hydromart stack with a starter catalog, depots, stock, and the
// first staff accounts — so a fresh deploy isn't empty. Idempotent: re-running
// skips anything already present (matched on natural keys: slug / sku / depot code
// / phone). Drives everything through the gateway over real HTTP, exactly like
// test/integration/flow.mjs, so it needs no DB access — just an up stack.
//
//   node scripts/seed.mjs
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret (mints the admin token)
import crypto from 'node:crypto';
import { fetchThrottled } from './lib/http.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// A SUPER_ADMIN bearer token, minted the same way the auth-service signs (HS256).
function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: 'HS256', typ: 'JWT' };
  const body = { sub: crypto.randomUUID(), role: 'SUPER_ADMIN', phone: '+620000000000', iat: now, exp: now + 900 };
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
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

function ok(res, step) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${step}: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

// Paginated list endpoints return { items: [...] }; plain ones return an array.
const rows = (payload) => (Array.isArray(payload) ? payload : payload?.items ?? []);

// ---------------------------------------------------------------- data
const CATEGORIES = [
  { name: 'Air Galon', slug: 'air-galon', sortOrder: 1 },
  { name: 'Air Kemasan', slug: 'air-kemasan', sortOrder: 2 },
  { name: 'Aksesoris', slug: 'aksesoris', sortOrder: 3 },
];

// isGallon and volumeMl are set EXPLICITLY, never inferred from the unit label.
// isGallon drives the per-galon delivery fee; a seeded galon without it prices at
// zero delivery. volumeMl feeds the depot water-meter reconciliation — null means
// "unmeasured" there, which is correct for accessories and honest for a dus whose
// pack size we do not model.
const PRODUCTS = [
  { sku: 'AIR-GALON-19L', name: 'Air Galon 19L (Isi Ulang)', unit: 'Galon 19L', volumeMl: 19000, isGallon: true, basePrice: 20000, cat: 'air-galon' },
  { sku: 'GALON-BARU-19L', name: 'Galon 19L + Air (Baru)', unit: 'Galon 19L', volumeMl: 19000, isGallon: true, basePrice: 65000, cat: 'air-galon' },
  { sku: 'AIR-BTL-600', name: 'Air Botol 600ml (Dus isi 24)', unit: 'Dus', volumeMl: 14400, isGallon: false, basePrice: 48000, cat: 'air-kemasan' },
  { sku: 'AIR-BTL-1500', name: 'Air Botol 1500ml (Dus isi 12)', unit: 'Dus', volumeMl: 18000, isGallon: false, basePrice: 54000, cat: 'air-kemasan' },
  { sku: 'AIR-CUP-240', name: 'Air Gelas 240ml (Dus isi 48)', unit: 'Dus', volumeMl: 11520, isGallon: false, basePrice: 22000, cat: 'air-kemasan' },
  { sku: 'ACC-POMPA', name: 'Pompa Galon Manual', unit: 'Pcs', volumeMl: null, isGallon: false, basePrice: 25000, cat: 'aksesoris' },
];

const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '20:00' }]),
);

const DEPOTS = [
  {
    code: 'JKT-01', name: 'Depot Cikini', ownershipType: 'HKP',
    address: 'Jl. Cikini Raya No. 1', city: 'Jakarta Pusat', province: 'DKI Jakarta',
    lat: -6.1944, lng: 106.8412, serviceRadiusKm: 7, deliveryFee: 1000, minOrderAmount: 15000,
    paymentBankName: 'BCA', paymentBankAccountNumber: '1234567890', paymentBankAccountHolder: 'PT Hydromart Cikini',
  },
  {
    code: 'BDG-01', name: 'Depot Dago', ownershipType: 'WARALABA', ownerPhone: '+6281100000009',
    address: 'Jl. Ir. H. Djuanda No. 100', city: 'Bandung', province: 'Jawa Barat',
    lat: -6.8895, lng: 107.6131, serviceRadiusKm: 6, deliveryFee: 1000, minOrderAmount: 15000,
    paymentBankName: 'Mandiri', paymentBankAccountNumber: '2345678901', paymentBankAccountHolder: 'Waralaba Dago Sejahtera',
  },
  {
    code: 'SBY-01', name: 'Depot Gubeng', ownershipType: 'WARALABA', ownerPhone: '+6281100000010',
    address: 'Jl. Raya Gubeng No. 25', city: 'Surabaya', province: 'Jawa Timur',
    lat: -7.2657, lng: 112.7521, serviceRadiusKm: 6, deliveryFee: 1000, minOrderAmount: 15000,
    paymentBankName: 'BRI', paymentBankAccountNumber: '3456789012', paymentBankAccountHolder: 'Waralaba Gubeng Jaya',
  },
];

// First staff accounts. Sign in later with phone + OTP (console adapter logs the code in dev).
// Inviting staff now opens their HR record too, so every invite carries the employment
// fields hr-service needs to pay and roster them. Spread into each row rather than typed
// per person: which salary a seeded fixture has is not what any test is about.
const EMPLOYMENT = {
  position: 'Staf',
  joinDate: '2026-01-01',
  employmentStatus: 'PERMANENT',
  salaryType: 'MONTHLY',
  monthlyRate: 5_000_000,
};

const STAFF = [
  { phone: '+6281100000001', role: 'SUPER_ADMIN', fullName: 'Admin Hydromart', ...EMPLOYMENT },
  { phone: '+6281100000002', role: 'MANAGER', fullName: 'Manajer Depot Cikini', ...EMPLOYMENT },
  { phone: '+6281100000003', role: 'STAFF_DEPOT', fullName: 'Staf Depot Satu', ...EMPLOYMENT },
  { phone: '+6281100000004', role: 'HR', fullName: 'HR Hydromart', ...EMPLOYMENT },
  { phone: '+6281100000005', role: 'KEPALA_DEPOT', fullName: 'Kepala Depot Cikini', ...EMPLOYMENT },
  { phone: '+6281100000006', role: 'ASSISTANT_SUPERVISOR', fullName: 'Asisten SPV Satu', ...EMPLOYMENT },
  { phone: '+6281100000007', role: 'SUPERVISOR', fullName: 'SPV Satu', ...EMPLOYMENT },
  { phone: '+6281100000008', role: 'DIREKTUR', fullName: 'Direktur Hydromart', ...EMPLOYMENT },
  // Owners of the two WARALABA depots below. depot-service refuses to create a franchise
  // depot without one, so these are invited BEFORE the depots (see main()). They get no
  // employee record server-side — an owner is a counterpart, not headcount — but the DTO
  // still validates the shape, so the fields travel.
  { phone: '+6281100000009', role: 'FRANCHISE_OWNER', fullName: 'Pemilik Waralaba Dago', ...EMPLOYMENT },
  { phone: '+6281100000010', role: 'FRANCHISE_OWNER', fullName: 'Pemilik Waralaba Gubeng', ...EMPLOYMENT },
];

// Sample HR employees (HRIS module). Seeded into the first depot; joinDate fixed for
// idempotency. dailyRate/monthlyRate follow the salaryType the server validates.
const EMPLOYEES = [
  // `role` is the jabatan (drives the payroll tenure raise); employmentStatus is only the
  // employment class now — DEPOT_MANAGER stopped being one of those.
  { fullName: 'Budi Santoso', phone: '+6281100000101', position: 'Kepala Depot', role: 'KEPALA_DEPOT', employmentStatus: 'PERMANENT', salaryType: 'MONTHLY', monthlyRate: 5_000_000 },
  { fullName: 'Siti Aminah', phone: '+6281100000102', position: 'Kasir', role: 'STAFF_DEPOT', employmentStatus: 'PERMANENT', salaryType: 'DAILY', dailyRate: 100_000 },
  { fullName: 'Andi Pratama', phone: '+6281100000103', position: 'Kurir Gudang', role: 'STAFF_DEPOT', employmentStatus: 'TRAINING', salaryType: 'DAILY', dailyRate: 80_000 },
];

// Head-office fixtures. `nextRunAt` is left to the server: the executor computes it from
// the cadence, and a seeded one would be wrong the day after it was written.
const SCHEDULED_REPORTS = [
  {
    name: 'Ringkasan omzet harian',
    cadence: 'DAILY',
    recipients: ['finance@hydromart.id'],
    format: 'XLSX',
    dataset: 'REVENUE_BY_DEPOT',
  },
  {
    name: 'Rekap performa depot mingguan',
    cadence: 'WEEKLY',
    recipients: ['ops@hydromart.id', 'direktur@hydromart.id'],
    format: 'CSV',
    dataset: 'REVENUE_BY_DEPOT',
  },
];

const INCIDENTS = [
  {
    title: 'Latensi settlement meningkat',
    severity: 'WARNING',
    affectedService: 'payment-service',
    note: 'Contoh insiden (seed) — dipakai untuk menguji papan insiden.',
  },
];

// The customer a seeded depot subscription is linked to when the depot's own CRM directory
// is still empty. Not created here — a customer is a real signup, and inventing one would
// put a phone number nobody owns into the auth table.
const DEMO_CUSTOMER_PHONE = '+6281298765432';

const STOCK_QTY = 200;
const STOCK_MIN = 20;

// ---------------------------------------------------------------- seed
async function seedCategories() {
  const existing = new Map(rows(ok(await api('GET', '/products/api/v1/categories'), 'list categories')).map((c) => [c.slug, c.id]));
  for (const c of CATEGORIES) {
    if (existing.has(c.slug)) continue;
    const created = ok(await api('POST', '/products/api/v1/categories', c), `create category ${c.slug}`);
    existing.set(c.slug, created.id);
    console.log(`+ category ${c.slug}`);
  }
  return existing; // slug -> id
}

async function seedProducts(catBySlug) {
  const existing = new Set(rows(ok(await api('GET', '/products/api/v1/products?limit=100'), 'list products')).map((p) => p.sku));
  for (const p of PRODUCTS) {
    if (existing.has(p.sku)) continue;
    ok(await api('POST', '/products/api/v1/products', {
      name: p.name, sku: p.sku, unit: p.unit, volumeMl: p.volumeMl, isGallon: p.isGallon,
      basePrice: p.basePrice, categoryId: catBySlug.get(p.cat),
    }), `create product ${p.sku}`);
    console.log(`+ product ${p.sku}`);
  }
  // sku -> id map for stock seeding.
  return new Map(rows(ok(await api('GET', '/products/api/v1/products?limit=100'), 'relist products')).map((p) => [p.sku, p.id]));
}

// The franchise owners must exist before their depots do. Invited on their own here (not
// depot-locked, so no depotId needed); seedStaff re-invites them idempotently later.
async function seedFranchiseOwners() {
  const byPhone = new Map();
  for (const s of STAFF.filter((s) => s.role === 'FRANCHISE_OWNER')) {
    const owner = ok(await api('POST', '/auth/api/v1/auth/staff/invite', s), `invite owner ${s.phone}`);
    byPhone.set(s.phone, owner.id);
    console.log(`+ staff ${s.role} ${s.phone}`);
  }
  return byPhone;
}

async function seedDepots(ownerByPhone) {
  const existing = new Map(rows(ok(await api('GET', '/depots/api/v1/depots/manage?limit=100'), 'list depots')).map((d) => [d.code, d.id]));
  for (const d of DEPOTS) {
    if (existing.has(d.code)) continue;
    const { ownerPhone, ...depot } = d;
    const created = ok(await api('POST', '/depots/api/v1/depots', { ...depot, ownerId: ownerByPhone.get(ownerPhone) ?? null, operatingHours: HOURS, holidays: [] }), `create depot ${d.code}`);
    existing.set(d.code, created.id);
    console.log(`+ depot ${d.code}`);
  }
  return existing; // code -> id
}

async function seedStock(depotByCode, productBySku) {
  for (const [code, depotId] of depotByCode) {
    const have = new Set(
      rows(ok(await api('GET', `/depots/api/v1/depots/${depotId}/inventory`), `list inventory ${code}`))
        .map((i) => i.productId)
        .filter(Boolean),
    );
    for (const p of PRODUCTS) {
      const productId = productBySku.get(p.sku);
      if (!productId || have.has(productId)) continue;
      ok(await api('POST', `/depots/api/v1/depots/${depotId}/inventory`, {
        itemType: 'PRODUK', productId, label: p.name, unit: p.unit, quantity: STOCK_QTY, minimumStock: STOCK_MIN,
      }), `stock ${code}/${p.sku}`);
      console.log(`+ stock ${code}/${p.sku}`);
    }
  }
}

// STAFF_DEPOT and KEPALA_DEPOT are depot-locked (DEPOT_LOCKED_ROLES): auth-service refuses the
// invite outright without a depot, because such an account can see nothing at all. Everyone else
// is either network-wide or resolves their depots from the hierarchy, so no depot is sent.
const DEPOT_LOCKED = new Set(['STAFF_DEPOT', 'KEPALA_DEPOT']);

async function seedStaff(depotByCode) {
  const depotId = [...depotByCode.values()][0];
  const idByPhone = new Map();
  // inviteStaff is idempotent server-side (promotes an existing phone), so just POST each.
  for (const s of STAFF) {
    const payload = DEPOT_LOCKED.has(s.role) ? { ...s, depotId } : s;
    const created = ok(await api('POST', '/auth/api/v1/auth/staff/invite', payload), `invite ${s.role} ${s.phone}`);
    if (created?.id) idByPhone.set(s.phone, created.id);
    console.log(`+ staff ${s.role} ${s.phone}`);
  }

  // A MANAGER carries no depot of their own — the comment above says they "resolve their
  // depots from the hierarchy", and the seed never built one. So the seeded manager
  // resolved to an EMPTY scope, and DepotScopeGuard denies an empty scope: every widget on
  // /dashboard and all seven /m/manager screens answered 403, on a console that still drew
  // its shell and its depot switcher. Found by signing in as the manager and looking.
  //
  // A direct grant rather than a supervision chain: the fixture needs one manager who can
  // see one depot, not an org chart (scripts/seed-hierarchy.mjs is where that lives).
  const managerId = idByPhone.get('+6281100000002');
  if (managerId) {
    const res = await api('PUT', `/depots/api/v1/staff-hierarchy/${managerId}/depots/${depotId}`, {});
    if (res.status >= 200 && res.status < 300) console.log('+ manager granted depot scope');
    else console.log(`- manager depot grant skipped: HTTP ${res.status}`);
  }
}

// HR employees list returns { rows, total }, not { items } — read .rows directly.
async function seedEmployees(depotByCode) {
  const depotId = [...depotByCode.values()][0];
  if (!depotId) return;
  const listed = ok(await api('GET', '/employees/api/v1/employees?pageSize=100'), 'list employees');
  const existing = new Set((listed.rows ?? []).map((e) => e.phone));
  for (const e of EMPLOYEES) {
    if (existing.has(e.phone)) continue;
    const res = await api('POST', '/employees/api/v1/employees', {
      ...e,
      depotId,
      joinDate: '2026-01-06T00:00:00.000Z',
    });
    // The list above is depot-scoped, so a person seeded at ANOTHER depot is absent from
    // it and the POST is the first thing that notices. hr-service answers 400 "nomor
    // telepon sudah dipakai" — which is the same fact the skip above is testing for, and
    // failing the whole seed on it made re-running impossible.
    if (res.status === 400 && String(JSON.stringify(res.body)).includes('sudah dipakai')) {
      console.log(`= employee ${e.fullName} (sudah ada)`);
      continue;
    }
    ok(res, `employee ${e.fullName}`);
    console.log(`+ employee ${e.fullName}`);
  }
}

// HR master data. Empty here and a browser pass cannot tell "not seeded" from "broken":
// a shift dropdown with no options and a shift dropdown that failed to load look the same.
const DEPARTMENTS = [
  { code: 'OPS', name: 'Operasional' },
  { code: 'KEU', name: 'Keuangan' },
  { code: 'HRD', name: 'Sumber Daya Manusia' },
];
const SHIFTS = [
  { name: 'Pagi', startTime: '07:00', endTime: '15:00' },
  { name: 'Siang', startTime: '15:00', endTime: '23:00' },
];

async function seedHrMasterData(depotByCode) {
  const depotId = [...depotByCode.values()][0];
  if (!depotId) return;

  // Departments: network-wide (no depotId), so every depot's staff can sit in them.
  const deptRows = rows(ok(await api('GET', '/departments/api/v1/departments'), 'list departments'));
  const haveDept = new Set(deptRows.map((d) => d.code));
  for (const d of DEPARTMENTS) {
    if (haveDept.has(d.code)) continue;
    ok(await api('POST', '/departments/api/v1/departments', d), `department ${d.code}`);
    console.log(`+ department ${d.code}`);
  }

  const shiftRows = rows(ok(await api('GET', '/hr-shifts/api/v1/hr-shifts'), 'list shifts'));
  const shiftByName = new Map(shiftRows.map((sh) => [sh.name, sh.id]));
  for (const sh of SHIFTS) {
    if (shiftByName.has(sh.name)) continue;
    const created = ok(await api('POST', '/hr-shifts/api/v1/hr-shifts', { ...sh, depotId }), `shift ${sh.name}`);
    shiftByName.set(sh.name, created.id);
    console.log(`+ shift ${sh.name}`);
  }

  // One rotation, Sunday off: the pattern keys are weekday numbers with 0 = Sunday, and a
  // MISSING key is a day off rather than a guess at the nearest shift.
  const rotRows = rows(ok(await api('GET', '/shift-rotations/api/v1/shift-rotations'), 'list rotations'));
  let rotationId = rotRows.find((r) => r.name === 'Rotasi Depot')?.id;
  if (!rotationId) {
    const pattern = {};
    for (const day of [1, 2, 3, 4, 5, 6]) {
      pattern[String(day)] = shiftByName.get(day % 2 ? 'Pagi' : 'Siang') ?? null;
    }
    rotationId = ok(
      await api('POST', '/shift-rotations/api/v1/shift-rotations', { name: 'Rotasi Depot', depotId, pattern }),
      'create rotation',
    ).id;
    console.log('+ rotation Rotasi Depot');
  }

  const listed = ok(await api('GET', '/employees/api/v1/employees?pageSize=100'), 'list employees for HR seed');
  const first = (listed.rows ?? [])[0];
  if (!first) return;

  const assigned = rows(
    ok(await api('GET', `/shift-rotations/api/v1/shift-rotations/assignments?employeeId=${first.id}`), 'list assignments'),
  );
  if (assigned.length === 0) {
    ok(
      await api('POST', '/shift-rotations/api/v1/shift-rotations/assignments', {
        employeeId: first.id,
        rotationId,
        effectiveFrom: '2026-01-06T00:00:00.000Z',
      }),
      'assign rotation',
    );
    console.log(`+ shift assignment ${first.fullName}`);
  }

  const loans = rows(ok(await api('GET', `/loans/api/v1/loans?employeeId=${first.id}`), 'list loans'));
  if (loans.length === 0) {
    ok(
      await api('POST', '/loans/api/v1/loans', {
        employeeId: first.id,
        principal: 1_500_000,
        installmentAmount: 250_000,
        startPeriod: '2026-02',
        note: 'Kasbon contoh (seed)',
      }),
      'create loan',
    );
    console.log(`+ loan ${first.fullName}`);
  }
}

/**
 * Head-office master data. These three tables were the last empty ones in admin-service,
 * so /hq/scheduled-reports, /hq/onboarding and /hq/incidents all rendered their
 * empty-state — which reads exactly like a screen that was never wired up.
 *
 * Idempotent on natural keys: report name, incident title, and the wizard step (a
 * singleton row that PATCH toggles).
 */
async function seedAdminMasterData() {
  // admin-service is not in every stack this seed runs against — the e2e compose brings up
  // 17 services and admin is not one of them, so the gateway answers 500 for its whole
  // segment. A service that is not deployed is not a broken seed: the first read decides,
  // and skipping says so out loud rather than failing the run at the last step.
  const probe = await api('GET', '/admin/api/v1/scheduled-reports');
  if (probe.status < 200 || probe.status >= 300) {
    console.log(`- admin master data skipped: /admin unreachable (HTTP ${probe.status})`);
    return;
  }
  const reports = rows(probe.body);
  const haveReport = new Set(reports.map((r) => r.name));
  for (const r of SCHEDULED_REPORTS) {
    if (haveReport.has(r.name)) continue;
    ok(await api('POST', '/admin/api/v1/scheduled-reports', r), `scheduled report ${r.name}`);
    console.log(`+ scheduled report ${r.name}`);
  }

  const incidents = rows(ok(await api('GET', '/admin/api/v1/incidents'), 'list incidents'));
  const haveIncident = new Set(incidents.map((i) => i.title));
  for (const i of INCIDENTS) {
    if (haveIncident.has(i.title)) continue;
    ok(await api('POST', '/admin/api/v1/incidents', i), `incident ${i.title}`);
    console.log(`+ incident ${i.title}`);
  }

  // The wizard state is a singleton the GET creates on first read; PATCH is what puts a
  // row's steps somewhere other than "nothing done". Two of five, so the screen shows
  // both a done step and a pending one.
  const state = ok(await api('GET', '/admin/api/v1/onboarding'), 'read onboarding state');
  for (const step of ['verify2fa', 'addDepot']) {
    if (state?.steps?.[step]) continue;
    ok(await api('PATCH', '/admin/api/v1/onboarding', { step, done: true }), `onboarding ${step}`);
    console.log(`+ onboarding step ${step}`);
  }
}

/**
 * Depot master data that only the console could create until now: a recurring order and a
 * closed book. `customerId` is REQUIRED on a subscription (S2) — a free-text name is a
 * note, not a link — so this picks a real customer out of the depot's own CRM directory
 * and skips the row entirely when the directory is empty rather than inventing one.
 */
async function seedDepotMasterData(depotByCode) {
  const depotId = [...depotByCode.values()][0];
  if (!depotId) return;

  const probe = await api('GET', `/depots/api/v1/subscriptions?depotId=${depotId}`);
  if (probe.status < 200 || probe.status >= 300) {
    console.log(`- depot master data skipped: subscriptions unreachable (HTTP ${probe.status})`);
    return;
  }
  const existing = rows(probe.body);
  if (existing.length === 0) {
    const customers = rows(
      ok(await api('GET', `/customers/api/v1/customers/depot?depotId=${depotId}`), 'list depot customers'),
    );
    // The depot directory only holds customers who have ordered from THIS depot, and the
    // seed creates no orders — so on a fresh stack it is empty. Falling back to a lookup by
    // phone keeps the fixture honest: it links a customer that exists, or seeds nothing.
    let customer = customers[0];
    if (!customer) {
      const found = await api('GET', `/auth/api/v1/auth/customers/lookup?phone=${encodeURIComponent(DEMO_CUSTOMER_PHONE)}`);
      if (found.status >= 200 && found.status < 300) customer = found.body;
    }
    if (!customer) {
      console.log(`- subscription skipped: no customer in the depot directory and no ${DEMO_CUSTOMER_PHONE}`);
    } else {
      ok(
        await api('POST', '/depots/api/v1/subscriptions', {
          depotId,
          customerId: customer.id,
          customerName: customer.fullName ?? customer.name ?? 'Pelanggan',
          productLabel: 'Galon 19L',
          quantity: 2,
          cadence: 'WEEKLY',
          note: 'Langganan contoh (seed)',
        }),
        'create subscription',
      );
      console.log(`+ subscription ${customer.fullName ?? customer.id}`);
    }
  }

  // A day that is over: yesterday in the business zone, never today — closing the current
  // day would refuse anything the rest of the seed still wants to record against it.
  const businessDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const close = ok(
    await api('GET', `/depots/api/v1/depots/${depotId}/daily-close?businessDate=${businessDate}`),
    'read daily close',
  );
  if (!close?.closedAt) {
    const res = await api('POST', `/depots/api/v1/depots/${depotId}/daily-close`, {
      businessDate,
      note: 'Tutup buku contoh (seed)',
    });
    if (res.status >= 200 && res.status < 300) console.log(`+ daily close ${businessDate}`);
    else console.log(`- daily close skipped: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  }
}

async function main() {
  console.log(`Seeding ${GATEWAY} ...`);
  const catBySlug = await seedCategories();
  const productBySku = await seedProducts(catBySlug);
  const ownerByPhone = await seedFranchiseOwners();
  const depotByCode = await seedDepots(ownerByPhone);
  await seedStock(depotByCode, productBySku);
  await seedStaff(depotByCode);
  await seedEmployees(depotByCode);
  await seedHrMasterData(depotByCode);
  await seedAdminMasterData();
  await seedDepotMasterData(depotByCode);
  console.log('\nSEED COMPLETE. Staff sign in with phone + OTP:');
  for (const s of STAFF) console.log(`  ${s.role.padEnd(14)} ${s.phone}  (${s.fullName})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
