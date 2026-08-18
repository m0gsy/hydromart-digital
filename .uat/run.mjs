// UAT driver: provision role tokens, run every module, dump results.json.
//   node run.mjs            -> all modules
//   node run.mjs m01 m02    -> only those module files
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { api, mintToken, results, save, loginPhone } from './lib.mjs';
import { seedQueues, seedPoints } from './seed-queues.mjs';

/*
 * `fileURLToPath`, not a hand-rolled strip of the leading slash.
 *
 * The old line was `new URL(import.meta.url).pathname.replace(/^\//, '')`, which is correct
 * on Windows — `/G:/repo/.uat` becomes `G:/repo/.uat` — and destroys the path on Linux,
 * where `/home/runner/...` becomes `home/runner/...`, relative to wherever the process
 * happens to be. The whole 439-case harness ran to completion in CI and then died on its
 * very last line writing results.json to a directory that does not exist.
 *
 * It could not have failed on the laptop it was written on. That is exactly the shape of
 * bug that only a second machine ever finds.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

// 500 ran out before the M29 cases (ORDER_INSUFFICIENT_STOCK on the last checkout of the
// sweep), which blocked them for no product reason.
const TARGET_STOCK = 2000;
const GALLON_HEADROOM = 500;
const GALLON_DEPOSIT = 20000;

const ctx = {
  admin: mintToken('SUPER_ADMIN'),
  hq: mintToken('HEAD_OFFICE'),
  finance: mintToken('FINANCE'),
  marketing: mintToken('MARKETING'),
  hr: mintToken('HR'),
};

async function provision() {
  // depots + products from the seed
  const d = await api('GET', '/depots/api/v1/depots/manage?limit=100', { token: ctx.admin });
  const depots = Array.isArray(d.body) ? d.body : d.body?.items ?? [];
  ctx.depotA = depots.find((x) => x.code === 'JKT-01') ?? depots[0];
  ctx.depotB = depots.find((x) => x.id !== ctx.depotA?.id);
  if (!ctx.depotA) throw new Error(`no depots seeded: HTTP ${d.status} ${JSON.stringify(d.body).slice(0, 200)}`);

  // staff tokens scoped to depot A (role + depotId claims, as the guards expect)
  ctx.operator = mintToken('STAFF_DEPOT', { depotId: ctx.depotA.id });
  ctx.manager = mintToken('KEPALA_DEPOT', { depotId: ctx.depotA.id });
  ctx.operatorB = mintToken('STAFF_DEPOT', { depotId: ctx.depotB?.id });
  ctx.managerB = mintToken('KEPALA_DEPOT', { depotId: ctx.depotB?.id });
  ctx.franchiseA = mintToken('FRANCHISE_OWNER', { depotId: ctx.depotA.id });
  ctx.franchiseB = mintToken('FRANCHISE_OWNER', { depotId: ctx.depotB?.id });
  // Drivers must be real accounts — delivery assignment stores the driverId and the
  // courier's own token has to carry the same sub, or every /driver/* call is a 403.
  // Fresh couriers per run: a leftover active delivery from an earlier run would make
  // every assignment fail with DELIVERY_DRIVER_BUSY.
  const drivers = [];
  for (let i = 0; i < 2; i += 1) {
    const p = `+62821${String(Date.now() + i).slice(-8)}`;
    const inv = await api('POST', '/auth/api/v1/auth/staff/invite', {
      token: ctx.admin, body: { phone: p, role: 'STAFF_DEPOT', fullName: `Kurir UAT ${i + 1}`, depotId: ctx.depotA.id },
    });
    if (inv.status < 400) drivers.push(inv.body);
  }
  ctx.driverAId = drivers[0]?.id;
  ctx.driverBId = drivers[1]?.id;
  ctx.driverA = mintToken('STAFF_DEPOT', { sub: ctx.driverAId, depotId: ctx.depotA.id });
  ctx.driverB = mintToken('STAFF_DEPOT', { sub: ctx.driverBId, depotId: ctx.depotA.id });

  // Catalog product used across cart/checkout/inventory checks.
  const pl = await api('GET', '/products/api/v1/products?limit=100');
  const products = Array.isArray(pl.body) ? pl.body : pl.body?.items ?? [];
  ctx.product = products.find((p) => p.sku === 'AIR-GALON-19L') ?? products[0];

  // Stock. The previous run left every checkout at ORDER_INSUFFICIENT_STOCK, which took
  // out M4-04 and then everything downstream that needs a real order (M4-12/15/17,
  // M15-05, M16-01/09). The harness provisions its own stock the same way it provisions
  // drivers and customers, so a run never depends on whatever a prior run left behind.
  ctx.stock = {};
  for (const [key, depot] of [['A', ctx.depotA], ['B', ctx.depotB]]) {
    if (!depot || !ctx.product) continue;
    const inv = `/depots/api/v1/depots/${depot.id}/inventory`;
    const listed = await api('GET', inv, { token: ctx.operator });
    const rows = Array.isArray(listed.body) ? listed.body : listed.body?.items ?? [];
    let line = rows.find((r) => r.productId === ctx.product.id);
    if (!line) {
      const created = await api('POST', inv, {
        token: ctx.admin,
        body: {
          itemType: 'PRODUK', productId: ctx.product.id, label: ctx.product.name ?? 'Galon 19L',
          unit: ctx.product.unit ?? 'galon', quantity: TARGET_STOCK, minimumStock: 20,
        },
      });
      line = created.status < 400 ? created.body : null;
    }
    if (!line) { console.log(`WARN no stock line for depot ${depot.code}`); continue; }
    // Top the line back up to a known quantity — opname sets an absolute count, so the
    // run starts from the same place no matter what earlier runs consumed or reserved.
    const reset = await api('POST', `/depots/api/v1/inventory/${line.id}/opname`, {
      // + reserved: prior runs leave holds behind, and available = quantity - reserved.
      token: ctx.admin,
      body: { countedQuantity: TARGET_STOCK + Number(line.reserved ?? 0), reason: 'UAT run baseline' },
    });
    ctx.stock[key] = reset.status < 400 ? reset.body : line;
  }
  ctx.stockLineA = ctx.stock.A;

  // Gallons out. Returns are now capped at what the depot actually has outstanding
  // (GALLON_OVER_RETURN), so the M15 cases need empties issued BEFORE they can hand any
  // back. Earlier runs left JKT-01 at 69 returned against 30 issued and Rp7.370.000
  // refunded against Rp120.000 held — the old unguarded code accepted that, and the
  // imbalance then blocked every legitimate return. Issuing our own headroom keeps the
  // run self-sufficient instead of depending on (or having to delete) that history.
  for (const depot of [ctx.depotA, ctx.depotB].filter(Boolean)) {
    // Drop any per-depot gallonDepositIdr override first. The M29 per-depot-settings case
    // leaves JKT-01 at Rp1.000.000 PER GALLON while issues still hold the Rp20.000 default,
    // so a 5-gallon courier return tries to refund Rp5.000.000 against a few hundred
    // thousand held. Reset to the platform default so the M15 cases measure the return
    // flow, not a leftover override.
    await api('DELETE', '/depots/api/v1/settings', {
      token: ctx.admin, body: { scope: 'DEPOT', depotId: depot.id, key: 'gallonDepositIdr' },
    });
    const gi = `/depots/api/v1/depots/${depot.id}/gallon-issues`;
    const summary = await api('GET', `${gi}/summary`, { token: ctx.admin });
    const gr = await api('GET', `/depots/api/v1/depots/${depot.id}/gallon-returns/summary`, { token: ctx.admin });
    const gallonGap = (gr.body?.gallons ?? 0) - (summary.body?.gallons ?? 0);
    const depositGap = (gr.body?.depositRefunded ?? 0) - (summary.body?.depositHeld ?? 0);
    const quantity = Math.max(GALLON_HEADROOM, gallonGap + GALLON_HEADROOM);
    const depositHeld = Math.max(quantity * GALLON_DEPOSIT, Math.ceil(depositGap) + quantity * GALLON_DEPOSIT);
    const iss = await api('POST', gi, {
      token: ctx.admin,
      body: { quantity, depositHeld, note: 'UAT run baseline — headroom for the return cases' },
    });
    if (iss.status >= 400) console.log(`WARN gallon headroom not issued for ${depot.code}: HTTP ${iss.status}`);
    else if (depot.id === ctx.depotA.id) ctx.gallonHeadroom = { quantity, depositHeld };
  }

  console.log(`depots: A=${ctx.depotA.code} B=${ctx.depotB?.code}; drivers: ${ctx.driverAId} / ${ctx.driverBId}; product: ${ctx.product?.sku}; stockA=${ctx.stock.A?.quantity ?? 'none'}`);
}

const MODULES = ['m01-auth.mjs', 'm02-m05.mjs', 'm06-m07.mjs', 'm08-m09.mjs', 'm10-m12.mjs',
  'm13-m17.mjs', 'm18-m21.mjs', 'm22-m25.mjs', 'm26-m29.mjs', 'm30-gaps.mjs'];

const wanted = process.argv.slice(2);
const files = MODULES.filter((f) => fs.existsSync(path.join(HERE, f)) && (!wanted.length || wanted.some((w) => f.startsWith(w))));

await provision();

// customer A comes out of M1 (real OTP flow); customer B is provisioned here for
// the IDOR checks so it exists even when M1 is skipped.
if (!files.includes('m01-auth.mjs')) {
  const pa = `+62812${Date.now().toString().slice(-8)}`;
  const a = await loginPhone(pa, 'UAT Customer A');
  if (a.ok) { ctx.customerA = a; ctx.customerAPhone = pa; }
}
const pb = `+62813${Date.now().toString().slice(-8)}`;
const b = await loginPhone(pb, 'UAT Customer B');
if (b.ok) { ctx.customerB = b; ctx.customerBPhone = pb; }
else console.log(`WARN customer B not provisioned: ${JSON.stringify(b.detail).slice(0, 200)}`);

// Resolve each customer's own id from whatever token is current. M01 mints customer A
// itself (real OTP flow) and rotates its token mid-module, so doing this once up front
// left customerAId undefined on every FULL run — which is what actually broke M18-06
// ("customerId must be a UUID") and M18-07 downstream of it. Re-resolve after each
// module, and re-resolve if the token was rotated since.
async function refreshCustomerIds() {
  for (const [tokenKey, idKey] of [['customerA', 'customerAId'], ['customerB', 'customerBId']]) {
    const token = ctx[tokenKey]?.accessToken;
    if (!token || ctx[idKey]) continue;
    const me = await api('GET', '/auth/api/v1/auth/me', { token });
    if (me.status < 400) ctx[idKey] = me.body?.id ?? me.body?.sub;
  }
}
await refreshCustomerIds();

// Fill the queues the script expects to already hold work (approvals, expense claims,
// settlements, fraud flags, …). Without this a third of the sweep reads an empty list and
// records Blocked for something that was never a product defect.
await seedQueues(ctx);
// UAT_SEED_ONLY=1 checks the provisioning by itself without paying for a full sweep.
if (process.env.UAT_SEED_ONLY) process.exit(0);

/**
 * Puts depot A's AVAILABLE stock back to the baseline between modules.
 *
 * Every checkout reserves stock and almost none of those orders is ever completed or
 * cancelled, so `available` (quantity - reserved) drifts down all run — it reached -376,
 * after which every checkout 422'd ORDER_INSUFFICIENT_STOCK. That produced the whole
 * "checkout failed" Blocked cluster in M14/M18/M19/M29; no product defect involved.
 * opname sets the PHYSICAL count, so count to TARGET + reserved to reset *available*.
 */
async function restock() {
  const line = ctx.stock?.A;
  if (!line?.id) return;
  const cur = (await api('GET', `/depots/api/v1/inventory/${line.id}`, { token: ctx.admin })).body;
  const reserved = Number(cur?.reserved ?? 0);
  const r = await api('POST', `/depots/api/v1/inventory/${line.id}/opname`, {
    token: ctx.admin,
    body: { countedQuantity: TARGET_STOCK + reserved, reason: 'UAT restock between modules' },
  });
  if (r.status >= 400) console.log(`WARN restock HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
}

for (const f of files) {
  console.log(`\n===== ${f} =====`);
  const mod = await import(`./${f}`);
  try { await mod.run(ctx); } catch (e) { console.log(`MODULE ${f} aborted: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`); }
  await refreshCustomerIds();
  // Customer A only exists once m01 has run the real OTP registration.
  if (f === 'm01-auth.mjs') await seedPoints(ctx);
  await restock();
}

save(path.join(HERE, 'results.json'));
fs.writeFileSync(path.join(HERE, 'ctx.json'), JSON.stringify(
  Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, typeof v === 'string' ? `${v.slice(0, 24)}…` : v])), null, 1));
process.exit(0);
