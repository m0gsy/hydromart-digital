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
  const res = await fetch(`${GATEWAY}${path}`, {
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

const PRODUCTS = [
  { sku: 'AIR-GALON-19L', name: 'Air Galon 19L (Isi Ulang)', unit: 'Galon 19L', basePrice: 20000, cat: 'air-galon' },
  { sku: 'GALON-BARU-19L', name: 'Galon 19L + Air (Baru)', unit: 'Galon 19L', basePrice: 65000, cat: 'air-galon' },
  { sku: 'AIR-BTL-600', name: 'Air Botol 600ml (Dus isi 24)', unit: 'Dus', basePrice: 48000, cat: 'air-kemasan' },
  { sku: 'AIR-BTL-1500', name: 'Air Botol 1500ml (Dus isi 12)', unit: 'Dus', basePrice: 54000, cat: 'air-kemasan' },
  { sku: 'AIR-CUP-240', name: 'Air Gelas 240ml (Dus isi 48)', unit: 'Dus', basePrice: 22000, cat: 'air-kemasan' },
  { sku: 'ACC-POMPA', name: 'Pompa Galon Manual', unit: 'Pcs', basePrice: 25000, cat: 'aksesoris' },
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
    code: 'BDG-01', name: 'Depot Dago', ownershipType: 'WARALABA',
    address: 'Jl. Ir. H. Djuanda No. 100', city: 'Bandung', province: 'Jawa Barat',
    lat: -6.8895, lng: 107.6131, serviceRadiusKm: 6, deliveryFee: 1000, minOrderAmount: 15000,
    paymentBankName: 'Mandiri', paymentBankAccountNumber: '2345678901', paymentBankAccountHolder: 'Waralaba Dago Sejahtera',
  },
  {
    code: 'SBY-01', name: 'Depot Gubeng', ownershipType: 'WARALABA',
    address: 'Jl. Raya Gubeng No. 25', city: 'Surabaya', province: 'Jawa Timur',
    lat: -7.2657, lng: 112.7521, serviceRadiusKm: 6, deliveryFee: 1000, minOrderAmount: 15000,
    paymentBankName: 'BRI', paymentBankAccountNumber: '3456789012', paymentBankAccountHolder: 'Waralaba Gubeng Jaya',
  },
];

// First staff accounts. Sign in later with phone + OTP (console adapter logs the code in dev).
const STAFF = [
  { phone: '+6281100000001', role: 'SUPER_ADMIN', fullName: 'Admin Hydromart' },
  { phone: '+6281100000002', role: 'DEPOT_MANAGER', fullName: 'Manajer Depot Cikini' },
  { phone: '+6281100000003', role: 'DRIVER', fullName: 'Driver Satu' },
  { phone: '+6281100000004', role: 'HR', fullName: 'HR Hydromart' },
];

// Sample HR employees (HRIS module). Seeded into the first depot; joinDate fixed for
// idempotency. dailyRate/monthlyRate follow the salaryType the server validates.
const EMPLOYEES = [
  { fullName: 'Budi Santoso', phone: '+6281100000101', position: 'Kepala Depot', employmentStatus: 'DEPOT_MANAGER', salaryType: 'MONTHLY', monthlyRate: 5_000_000 },
  { fullName: 'Siti Aminah', phone: '+6281100000102', position: 'Kasir', employmentStatus: 'PERMANENT', salaryType: 'DAILY', dailyRate: 100_000 },
  { fullName: 'Andi Pratama', phone: '+6281100000103', position: 'Kurir Gudang', employmentStatus: 'TRAINING', salaryType: 'DAILY', dailyRate: 80_000 },
];

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
      name: p.name, sku: p.sku, unit: p.unit, basePrice: p.basePrice, categoryId: catBySlug.get(p.cat),
    }), `create product ${p.sku}`);
    console.log(`+ product ${p.sku}`);
  }
  // sku -> id map for stock seeding.
  return new Map(rows(ok(await api('GET', '/products/api/v1/products?limit=100'), 'relist products')).map((p) => [p.sku, p.id]));
}

async function seedDepots() {
  const existing = new Map(rows(ok(await api('GET', '/depots/api/v1/depots/manage?limit=100'), 'list depots')).map((d) => [d.code, d.id]));
  for (const d of DEPOTS) {
    if (existing.has(d.code)) continue;
    const created = ok(await api('POST', '/depots/api/v1/depots', { ...d, operatingHours: HOURS, holidays: [] }), `create depot ${d.code}`);
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

async function seedStaff() {
  // inviteStaff is idempotent server-side (promotes an existing phone), so just POST each.
  for (const s of STAFF) {
    ok(await api('POST', '/auth/api/v1/auth/staff/invite', s), `invite ${s.role} ${s.phone}`);
    console.log(`+ staff ${s.role} ${s.phone}`);
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
    ok(await api('POST', '/employees/api/v1/employees', { ...e, depotId, joinDate: '2026-01-06T00:00:00.000Z' }), `employee ${e.fullName}`);
    console.log(`+ employee ${e.fullName}`);
  }
}

async function main() {
  console.log(`Seeding ${GATEWAY} ...`);
  const catBySlug = await seedCategories();
  const productBySku = await seedProducts(catBySlug);
  const depotByCode = await seedDepots();
  await seedStock(depotByCode, productBySku);
  await seedStaff();
  await seedEmployees(depotByCode);
  console.log('\nSEED COMPLETE. Staff sign in with phone + OTP:');
  for (const s of STAFF) console.log(`  ${s.role.padEnd(14)} ${s.phone}  (${s.fullName})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
