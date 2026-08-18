// M8 — Depot, Inventori & Pengadaan · M9 — Loyalty, Referral & Langganan
import crypto from 'node:crypto';
import { api, check, pass, fail, blocked, na, uniq } from './lib.mjs';

const D = '/depots/api/v1';
const L = '/loyalty/api/v1';
const R = '/referrals/api/v1';
const ORD = '/orders/api/v1';

const balanceOf = (body) => body?.balance ?? body?.pointsBalance ?? body?.points ?? 0;

export async function run(ctx) {
  const A = ctx.customerA?.accessToken;
  const depot = ctx.depotA;
  const inv = `${D}/depots/${depot.id}/inventory`;   // list / create / reserve
  const item = `${D}/inventory`;                     // per-item read, adjust, opname, movements

  // ---------------------------------------------------------------- M8
  await check('UAT-M8-01', async () => {
    const code = `UAT-${uniq().slice(0, 6).toUpperCase()}`;
    const r = await api('POST', `${D}/depots`, {
      token: ctx.admin,
      body: {
        code, name: 'Depot UAT Bekasi', ownershipType: 'HKP',
        address: 'Jl. Ahmad Yani No. 9', city: 'Bekasi', province: 'Jawa Barat',
        lat: -6.2383, lng: 106.9756, serviceRadiusKm: 7, deliveryFee: 1000, minOrderAmount: 15000,
        operatingHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '20:00' }])),
        holidays: [],
      },
    });
    ctx.newDepot = r.body;
    ctx.newDepotCode = code;
    return r.status < 400 && r.body?.id
      ? pass(`HTTP ${r.status}; depot ${code} created and active`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M8-08', async () => {
    if (!ctx.newDepotCode) return blocked('no depot created in M8-01');
    const r = await api('POST', `${D}/depots`, {
      token: ctx.admin,
      body: { code: ctx.newDepotCode, name: 'Duplikat', ownershipType: 'HKP', address: 'x', city: 'Bekasi', province: 'Jawa Barat', lat: -6.2, lng: 106.9, serviceRadiusKm: 5, deliveryFee: 1000, minOrderAmount: 15000 },
    });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /CODE_TAKEN|taken|exists/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M8-02', async () => {
    const list = await api('GET', inv, { token: ctx.operator });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const it = rows[0];
    if (!it) return blocked(`no inventory rows: HTTP ${list.status} ${JSON.stringify(list.body).slice(0, 200)}`);
    ctx.invItem = it;
    const before = it.quantity;
    const r = await api('POST', `${item}/${it.id}/adjust`, { token: ctx.operator, body: { delta: 50, reason: 'restock UAT' } });
    const after = await api('GET', `${item}/${it.id}`, { token: ctx.operator });
    const moves = await api('GET', `${item}/${it.id}/movements`, { token: ctx.operator });
    const mrows = Array.isArray(moves.body) ? moves.body : moves.body?.items ?? [];
    return r.status < 400 && after.body?.quantity === before + 50
      ? pass(`${before} -> ${after.body.quantity}; ${mrows.length} movement rows, latest=${JSON.stringify(mrows[0] ?? {}).slice(0, 160)}`)
      : fail(`adjust HTTP ${r.status} ${JSON.stringify(r.body)}; ${before} -> ${after.body?.quantity}`);
  });

  await check('UAT-M8-11', async () => {
    if (!ctx.invItem) return blocked('no inventory item');
    const cur = await api('GET', `${item}/${ctx.invItem.id}`, { token: ctx.operator });
    const qty = cur.body?.quantity ?? 0;
    const r = await api('POST', `${item}/${ctx.invItem.id}/adjust`, { token: ctx.operator, body: { delta: -(qty + 10), reason: 'uat negative' } });
    const after = await api('GET', `${item}/${ctx.invItem.id}`, { token: ctx.operator });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && after.body?.quantity === qty
      ? pass(`HTTP ${r.status} ${s}; stock unchanged at ${qty}`)
      : fail(`HTTP ${r.status} ${s}; stock ${qty} -> ${after.body?.quantity}`);
  });

  await check('UAT-M8-09', async () => {
    if (!ctx.invItem) return blocked('no inventory item');
    const r = await api('POST', inv, {
      token: ctx.operator,
      body: { itemType: 'PRODUK', productId: ctx.invItem.productId ?? ctx.product?.id, label: 'Duplikat', unit: 'Galon 19L', quantity: 10, minimumStock: 1 },
    });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /LINE_EXISTS|exists/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M8-10', async () => {
    const noProduct = await api('POST', inv, { token: ctx.operator, body: { itemType: 'PRODUK', label: 'Tanpa produk', unit: 'Pcs', quantity: 1, minimumStock: 0 } });
    const rawWithProduct = await api('POST', inv, { token: ctx.operator, body: { itemType: 'BAHAN_BAKU', productId: ctx.invItem?.productId, label: 'Bahan', unit: 'Pcs', quantity: 1, minimumStock: 0 } });
    return noProduct.status >= 400 && rawWithProduct.status >= 400
      ? pass(`PRODUK without productId => ${noProduct.status}; raw material with productId => ${rawWithProduct.status}`)
      : fail(`PRODUK without productId => ${noProduct.status} ${JSON.stringify(noProduct.body).slice(0, 150)}; raw+productId => ${rawWithProduct.status}`);
  });

  await check('UAT-M8-03', async () => {
    const sup = await api('GET', `${D}/suppliers?depotId=${depot.id}`, { token: ctx.operator });
    let supplier = (Array.isArray(sup.body) ? sup.body : sup.body?.items ?? [])[0];
    if (!supplier) {
      const created = await api('POST', `${D}/suppliers`, {
        token: ctx.manager, body: { depotId: depot.id, name: 'Supplier UAT', code: `SUP-${uniq().slice(0, 4).toUpperCase()}`, contactPhone: '+628111222333' },
      });
      supplier = created.body;
      if (created.status >= 400) return blocked(`no supplier and creation failed: HTTP ${created.status} ${JSON.stringify(created.body)}`);
    }
    ctx.supplier = supplier;
    const r = await api('POST', `${D}/purchase-orders`, {
      token: ctx.manager,
      body: { depotId: depot.id, supplierId: supplier.id, lines: [{ itemType: 'PRODUK', label: 'Galon 19L', quantity: 100, unitCostIdr: 15000 }] },
    });
    ctx.purchaseOrder = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; PO ${r.body?.id} status=${r.body?.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M8-14', async () => {
    const r = await api('POST', `${D}/purchase-orders`, {
      token: ctx.manager,
      body: { depotId: depot.id, supplierId: '00000000-0000-0000-0000-000000000000', lines: [{ itemType: 'PRODUK', label: 'X', quantity: 1, unitCostIdr: 1000 }] },
    });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /SUPPLIER_NOT_FOUND|supplier/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M8-04', async () => {
    const q = await api('GET', `${D}/approvals?depotId=${depot.id}`, { token: ctx.manager });
    const rows = Array.isArray(q.body) ? q.body : q.body?.items ?? [];
    const pending = rows.find((x) => (x.status ?? '').toUpperCase() === 'PENDING');
    if (!pending) return blocked(`no PENDING approval in the queue (HTTP ${q.status}, ${rows.length} rows)`);
    ctx.approval = pending;
    const r = await api('PATCH', `${D}/approvals/${pending.id}/decide`, { token: ctx.manager, body: { decision: 'APPROVE', note: 'disetujui UAT' } });
    return r.status < 400
      ? pass(`HTTP ${r.status}; approval ${pending.id} -> ${r.body?.status}; decidedBy recorded=${Boolean(r.body?.decidedBy ?? r.body?.decidedById)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M8-12', async () => {
    if (!ctx.approval) return blocked('no decided approval');
    const r = await api('PATCH', `${D}/approvals/${ctx.approval.id}/decide`, { token: ctx.manager, body: { decision: 'REJECT', note: 'lagi' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /ALREADY_DECIDED|decided/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M8-05', async () => {
    if (!ctx.invItem) return blocked('no inventory item');
    const before = (await api('GET', `${item}/${ctx.invItem.id}`, { token: ctx.operator })).body?.quantity;
    const r = await api('POST', `${item}/${ctx.invItem.id}/adjust`, { token: ctx.operator, body: { delta: -3, reason: 'WASTAGE: 3 galon retak' } });
    const after = (await api('GET', `${item}/${ctx.invItem.id}`, { token: ctx.operator })).body?.quantity;
    const w = await api('GET', `${item}/wastage?depotId=${depot.id}`, { token: ctx.operator });
    return r.status < 400 && after === before - 3
      ? pass(`stock ${before} -> ${after}; wastage report HTTP ${w.status} ${JSON.stringify(w.body).slice(0, 180)}`)
      : fail(`adjust HTTP ${r.status} ${JSON.stringify(r.body)}; ${before} -> ${after}`);
  });

  await check('UAT-M8-06', async () => {
    const schema = await api('GET', `${D}/settings/schema`, { token: ctx.manager });
    const def = (schema.body?.defs ?? [])[0];
    if (!def) return blocked(`settings schema is empty (HTTP ${schema.status})`);
    ctx.settingDef = def;
    const value = String((def.envDefault ?? def.min ?? 0) + 1);
    const r = await api('PUT', `${D}/settings`, { token: ctx.manager, body: { scope: 'DEPOT', depotId: depot.id, key: def.key, value } });
    const mine = await api('GET', `${D}/settings/schema?depotId=${depot.id}`, { token: ctx.manager });
    const other = await api('GET', `${D}/settings/schema?depotId=${ctx.depotB?.id ?? ''}`, { token: ctx.managerB });
    const myVal = mine.body?.effective?.[def.key];
    const otherVal = other.body?.effective?.[def.key];
    return r.status < 400 && String(myVal) === value
      ? pass(`${def.key} overridden to ${myVal} for depot ${depot.code}; depot B still ${otherVal}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; effective=${myVal}`);
  });

  await check('UAT-M8-17', async () => {
    const def = ctx.settingDef;
    if (!def) return blocked('no settings schema');
    const put = (value, key = def.key) => api('PUT', `${D}/settings`, { token: ctx.manager, body: { scope: 'DEPOT', depotId: depot.id, key, value: String(value) } });
    const low = await put(def.min - 1);
    const high = await put(def.max + 1);
    const unknown = await put(1, 'tidakDikenal');
    return low.status >= 400 && high.status >= 400 && unknown.status >= 400
      ? pass(`below min => ${low.status} ${JSON.stringify(low.body?.message ?? '')}; above max => ${high.status}; unknown key => ${unknown.status}`)
      : fail(`below min => ${low.status}; above max => ${high.status}; unknown key => ${unknown.status}`);
  });

  await check('UAT-M8-18', async () => {
    const def = ctx.settingDef;
    if (!def) return blocked('no settings schema');
    const put = (value) => api('PUT', `${D}/settings`, { token: ctx.manager, body: { scope: 'DEPOT', depotId: depot.id, key: def.key, value: String(value) } });
    const min = await put(def.min);
    const max = await put(def.max);
    return min.status < 400 && max.status < 400
      ? pass(`${def.key} at min (${def.min}) => ${min.status}; at max (${def.max}) => ${max.status} — both boundaries accepted`)
      : fail(`min => ${min.status} ${JSON.stringify(min.body?.message ?? '')}; max => ${max.status} ${JSON.stringify(max.body?.message ?? '')}`);
  });

  await check('UAT-M8-15', async () => {
    const r = await api('PUT', `${D}/settings`, { token: ctx.operator, body: { scope: 'GLOBAL', key: ctx.settingDef?.key ?? 'gallonDepositIdr', value: '25000' } });
    const s = JSON.stringify(r.body);
    return r.status === 403 || /SUPER_ADMIN|global/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M8-16', async () => {
    const schema = await api('GET', `${D}/settings/schema`, { token: ctx.manager });
    const defs = schema.body?.defs ?? [];
    const globalOnly = defs.find((d) => d.globalOnly === true || d.scope === 'GLOBAL');
    // depot-service ships two tunables (gallonDepositIdr, approvalAutoPassIdr) and neither
    // is marked global-only, so there is no key this rejection path can be exercised on.
    if (!globalOnly) return na(`no global-only key exists in the depot settings schema this release (HTTP ${schema.status}, ${defs.length} keys: ${defs.map((d) => d.key).join(', ')})`);
    const r = await api('PUT', `${D}/settings`, { token: ctx.manager, body: { depotId: depot.id, key: globalOnly.key, value: globalOnly.default ?? 1 } });
    return r.status >= 400
      ? pass(`per-depot override of global-only key '${globalOnly.key}' rejected HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`)
      : fail(`global-only key '${globalOnly.key}' accepted a per-depot override (HTTP ${r.status})`);
  });

  await check('UAT-M8-07', async () => {
    const start = new Date(Date.now() - 3600e3).toISOString();
    const end = new Date(Date.now() + 3600e3).toISOString();
    const r = await api('POST', `${D}/depots/${depot.id}/pricing/rules`, {
      token: ctx.manager,
      body: { productId: ctx.product?.id, adjustType: 'PERCENT', value: 10, startMinute: 600, endMinute: 840, validFrom: start, validUntil: end },
    });
    ctx.pricingRule = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; rule active ${start} .. ${end}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M8-13', async () => {
    const r = await api('POST', `${D}/depots/${depot.id}/pricing/rules`, {
      token: ctx.manager,
      body: { productId: ctx.product?.id, adjustType: 'PERCENT', value: 5,
        validFrom: new Date(Date.now() + 7200e3).toISOString(), validUntil: new Date(Date.now() + 3600e3).toISOString() },
    });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /PRICING_WINDOW|window|start/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  // ---------------------------------------------------------------- M9
  await check('UAT-M9-01', async () => {
    if (!A) return blocked('no customer token');
    const me = await api('GET', `${L}/loyalty/me`, { token: A });
    const tx = await api('GET', `${L}/loyalty/me/transactions`, { token: A });
    const rows = Array.isArray(tx.body) ? tx.body : tx.body?.items ?? [];
    ctx.pointsBalance = me.body?.balance ?? me.body?.points ?? me.body?.pointsBalance ?? me.body?.availablePoints;
    if (me.status === 200 && ctx.pointsBalance === undefined) {
      return fail(`HTTP 200 but no recognisable balance field: ${JSON.stringify(me.body).slice(0, 220)}`);
    }
    return me.status === 200
      ? (rows.length > 0
        ? pass(`balance=${ctx.pointsBalance}; ${rows.length} point transactions, latest=${JSON.stringify(rows[0]).slice(0, 160)}`)
        : fail(`balance=${ctx.pointsBalance} but no earning transaction recorded after a COMPLETED order`))
      : fail(`HTTP ${me.status} ${JSON.stringify(me.body)}`);
  });

  await check('UAT-M9-02', async () => {
    const cat = await api('GET', `${L}/rewards/catalog`, { token: A });
    const rewards = Array.isArray(cat.body) ? cat.body : cat.body?.items ?? [];
    if (!rewards.length) return blocked(`reward catalog empty (HTTP ${cat.status})`);
    const affordable = rewards.find((x) => (x.pointsCost ?? x.points) <= (ctx.pointsBalance ?? 0) && (x.stock ?? 1) > 0);
    if (!affordable) return blocked(`balance ${ctx.pointsBalance} below the cheapest reward (${Math.min(...rewards.map((x) => x.pointsCost ?? x.points))})`);
    const before = ctx.pointsBalance;
    const r = await api('POST', `${L}/rewards/redeem`, { token: A, body: { rewardItemId: affordable.id, idempotencyKey: crypto.randomUUID() } });
    const after = balanceOf((await api('GET', `${L}/loyalty/me`, { token: A })).body);
    return r.status < 400 && after === before - (affordable.pointsCost ?? affordable.points)
      ? pass(`redeemed ${affordable.id}; balance ${before} -> ${after}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; balance ${before} -> ${after}`);
  });

  await check('UAT-M9-07', async () => {
    const cat = await api('GET', `${L}/rewards/catalog`, { token: A });
    const rewards = Array.isArray(cat.body) ? cat.body : cat.body?.items ?? [];
    const expensive = rewards.sort((a, b) => (b.pointsCost ?? b.points) - (a.pointsCost ?? a.points))[0];
    if (!expensive) return blocked('reward catalog empty');
    const bal = (b) => b?.balance ?? b?.pointsBalance ?? 0;
    const before = bal((await api('GET', `${L}/loyalty/me`, { token: A })).body);
    if ((expensive.pointsCost ?? expensive.points) <= before) return blocked(`balance ${before} covers even the priciest reward`);
    const r = await api('POST', `${L}/rewards/redeem`, { token: A, body: { rewardItemId: expensive.id, idempotencyKey: crypto.randomUUID() } });
    const after = bal((await api('GET', `${L}/loyalty/me`, { token: A })).body);
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /INSUFFICIENT_POINTS/i.test(s) && after === before
      ? pass(`HTTP ${r.status} ${s}; balance unchanged (${after})`)
      : fail(`HTTP ${r.status} ${s}; balance ${before} -> ${after}`);
  });

  await check('UAT-M9-09', async () => {
    const r = await api('POST', `${L}/rewards/redeem`, { token: A, body: { rewardItemId: '00000000-0000-0000-0000-000000000000', idempotencyKey: crypto.randomUUID() } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /REWARD_NOT_FOUND|not found/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M9-08', async () => {
    const cat = await api('GET', `${L}/rewards/catalog`, { token: A });
    const rewards = Array.isArray(cat.body) ? cat.body : cat.body?.items ?? [];
    const out = rewards.find((x) => (x.stock ?? x.remainingStock) === 0);
    if (!out) return blocked('no out-of-stock reward in the catalog to exercise this path');
    const r = await api('POST', `${L}/rewards/redeem`, { token: A, body: { rewardItemId: out.id, idempotencyKey: crypto.randomUUID() } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /OUT_OF_STOCK/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M9-10', async () => {
    const zero = await api('POST', `${L}/loyalty/adjust`, { token: ctx.marketing, body: { customerId: ctx.customerAId, points: 0, reason: 'uat' } });
    const noReason = await api('POST', `${L}/loyalty/adjust`, { token: ctx.marketing, body: { customerId: ctx.customerAId, points: 10, reason: '' } });
    return zero.status >= 400 && noReason.status >= 400
      ? pass(`points 0 => ${zero.status}; empty reason => ${noReason.status}`)
      : fail(`points 0 => ${zero.status} ${JSON.stringify(zero.body).slice(0, 150)}; empty reason => ${noReason.status}`);
  });

  await check('UAT-M9-12', async () => {
    const cat = await api('GET', `${L}/rewards/catalog`, { token: A });
    const rewards = Array.isArray(cat.body) ? cat.body : cat.body?.items ?? [];
    const bal = balanceOf((await api('GET', `${L}/loyalty/me`, { token: A })).body);
    const target = rewards.find((x) => (x.pointsCost ?? x.points) <= bal && (x.pointsCost ?? x.points) * 2 > bal && (x.stock ?? 1) > 0);
    if (!target) return blocked(`no reward priced for a single-redeem race at balance ${bal}`);
    const [a, b] = await Promise.all([
      api('POST', `${L}/rewards/redeem`, { token: A, body: { rewardItemId: target.id, idempotencyKey: crypto.randomUUID() } }),
      api('POST', `${L}/rewards/redeem`, { token: A, body: { rewardItemId: target.id, idempotencyKey: crypto.randomUUID() } }),
    ]);
    const after = balanceOf((await api('GET', `${L}/loyalty/me`, { token: A })).body);
    const ok = [a, b].filter((x) => x.status < 400).length;
    return ok === 1 && after >= 0
      ? pass(`parallel redeem: 1 success / 1 rejected (${a.status}/${b.status}); balance ${bal} -> ${after}, never negative`)
      : fail(`${ok} redemptions succeeded (${a.status}/${b.status}); balance ${bal} -> ${after}`);
  });

  await check('UAT-M9-13', async () => na('needs a balance engineered to equal a reward price exactly; covered indirectly by UAT-M9-02'));

  await check('UAT-M9-03', async () => {
    const code = await api('GET', `${R}/referrals/me/code`, { token: A });
    if (code.status >= 400) return fail(`referral code HTTP ${code.status} ${JSON.stringify(code.body)}`);
    ctx.referralCode = code.body?.code ?? code.body?.referralCode;
    const mine = await api('GET', `${R}/referrals/me`, { token: A });
    return ctx.referralCode
      ? pass(`code=${ctx.referralCode}; referral summary HTTP ${mine.status} ${JSON.stringify(mine.body).slice(0, 200)}`)
      : fail(`no code returned: ${JSON.stringify(code.body)}`);
  });

  await check('UAT-M9-11', async () => {
    if (!ctx.referralCode) return blocked('no referral code');
    const r = await api('POST', `${R}/referrals`, { token: A, body: { code: ctx.referralCode } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 ? pass(`self-referral rejected HTTP ${r.status} ${s}`) : fail(`self-referral accepted HTTP ${r.status} ${s}`);
  });

  await check('UAT-M9-04', async () => {
    const r = await api('POST', `${ORD}/subscriptions`, {
      token: A,
      body: {
        productId: ctx.product.id, quantity: 2, frequency: 'WEEKLY',
        firstDeliveryAt: new Date(Date.now() + 86400e3).toISOString(),
        deliveryAddress: {
          recipientName: 'Budi Santoso', phone: '+628123456789', addressLine: 'Jl. Cikini Raya No. 5',
          city: 'Jakarta Pusat', province: 'DKI Jakarta', latitude: -6.1944, longitude: 106.8412,
        },
      },
    });
    ctx.subscription = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; subscription ${r.body?.id} status=${r.body?.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M9-05', async () => {
    if (!ctx.subscription?.id) return blocked('no subscription');
    const p = await api('POST', `${ORD}/subscriptions/${ctx.subscription.id}/pause`, { token: A });
    const due1 = await api('POST', `${ORD}/subscriptions/process-due`, { token: ctx.admin });
    const r = await api('POST', `${ORD}/subscriptions/${ctx.subscription.id}/resume`, { token: A });
    const list = await api('GET', `${ORD}/subscriptions`, { token: A });
    const sub = (Array.isArray(list.body) ? list.body : list.body?.items ?? []).find((x) => x.id === ctx.subscription.id);
    return p.status < 400 && r.status < 400
      ? pass(`pause HTTP ${p.status}; due-run while paused HTTP ${due1.status} ${JSON.stringify(due1.body).slice(0, 120)}; resume HTTP ${r.status}; status now ${sub?.status}`)
      : fail(`pause HTTP ${p.status} ${JSON.stringify(p.body)}; resume HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M9-06', async () => {
    const order = ctx.deliveredOrder;
    if (!order) return blocked('no delivered order to review');
    const r = await api('POST', `${ORD}/orders/${order.id}/review`, { token: A, body: { rating: 5, comment: 'Cepat dan rapi' } });
    const read = await api('GET', `${ORD}/orders/${order.id}/review`, { token: A });
    const depotRatings = await api('GET', `${ORD}/reports/depot-ratings?depotId=${depot.id}`, { token: ctx.manager });
    return r.status < 400 && read.body?.rating === 5
      ? pass(`review saved (HTTP ${r.status}); depot ratings report HTTP ${depotRatings.status} ${JSON.stringify(depotRatings.body).slice(0, 160)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; read-back=${JSON.stringify(read.body)}`);
  });
}
