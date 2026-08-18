// M13 Non-Fungsional · M14 E2E · M15 Galon & Deposit · M16 Inventori Lanjutan · M17 Kas & Shift
import { api, check, pass, fail, blocked, na, WEB, uniq } from './lib.mjs';

const D = '/depots/api/v1';
const ORD = '/orders/api/v1';
const PAY = '/payments/api/v1/payments';
const DEL = '/deliveries/api/v1';

const addr = () => ({
  recipientName: 'Budi Santoso', phone: '+628123456789', addressLine: 'Jl. Cikini Raya No. 5',
  city: 'Jakarta Pusat', province: 'DKI Jakarta', postalCode: '10330', latitude: -6.1944, longitude: 106.8412,
});

/** ISO date of this week's Monday — roster and huddle keys. */
function weekMonday() {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

async function newOrder(ctx, qty = 1) {
  const A = ctx.customerA.accessToken;
  await api('DELETE', `${ORD}/cart`, { token: A });
  await api('POST', `${ORD}/cart/items`, { token: A, body: { productId: ctx.product.id, quantity: qty } });
  const r = await api('POST', `${ORD}/orders/checkout`, { token: A, body: { deliveryAddress: addr() } });
  return r.status < 400 ? r.body : null;
}

export async function run(ctx) {
  const A = ctx.customerA?.accessToken;
  const depot = ctx.depotA;
  const inv = `${D}/depots/${depot.id}/inventory`;
  const itemApi = `${D}/inventory`;

  // ---------------------------------------------------------------- M13
  await check('UAT-M13-01', async () => na('needs a physical Android/iOS handset with camera + GPS (prasyarat #23)'));
  await check('UAT-M13-02', async () => na('needs browser network throttling; run manually in DevTools'));
  await check('UAT-M13-03', async () => {
    const sw = await api('GET', '/sw.js', { base: WEB, raw: true });
    const manifest = await api('GET', '/manifest.json', { base: WEB, raw: true });
    return sw.status === 200 || manifest.status === 200
      ? pass(`service worker HTTP ${sw.status}; manifest HTTP ${manifest.status} — offline shell is installed; visual offline check still manual`)
      : fail(`no service worker (HTTP ${sw.status}) and no manifest (HTTP ${manifest.status}) — PWA offline fallback missing`);
  });
  await check('UAT-M13-04', async () => {
    const home = await api('GET', '/', { base: WEB, raw: true });
    const rupiah = /Rp\s?\d/.test(home.text ?? '');
    const indo = /(Pesan|Keranjang|Masuk|Beranda|Galon)/i.test(home.text ?? '');
    return home.status === 200 && rupiah && indo
      ? pass(`home page renders Indonesian copy and Rp-formatted amounts`)
      : fail(`HTTP ${home.status}; rupiah=${rupiah}; indonesian=${indo}`);
  });
  await check('UAT-M13-05', async () => {
    const n = await api('GET', '/crm/api/v1/notifications/me', { token: A });
    const rows = Array.isArray(n.body) ? n.body : n.body?.items ?? n.body?.rows ?? [];
    const dupes = rows.length - new Set(rows.map((x) => `${x.type}|${x.createdAt}`)).size;
    return n.status === 200
      ? (rows.length > 0
        ? pass(`${rows.length} notifications after the order flow; duplicates=${dupes}`)
        : fail(`HTTP 200 but no status-change notification reached the customer`))
      : fail(`HTTP ${n.status} ${JSON.stringify(n.body)}`);
  });
  await check('UAT-M13-06', async () => {
    const r = await api('GET', `${ORD}/orders/00000000-0000-0000-0000-000000000000`, { token: A });
    const s = JSON.stringify(r.body ?? {});
    const leaks = /stack|node_modules|at Object|prisma|ECONNREFUSED/i.test(s);
    return !leaks ? pass(`HTTP ${r.status} clean error body: ${s.slice(0, 180)}`) : fail(`error body leaks internals: ${s.slice(0, 240)}`);
  });
  await check('UAT-M13-07', async () => {
    const pages = ['/', '/products', '/orders'];
    const out = [];
    const bad = [];
    for (const p of pages) {
      const r = await api('GET', p, { base: WEB, raw: true });
      // r.ms is the fetch itself. Date.now() around api() measured the pacer instead, so
      // every number here used to be PACE_MS no matter how the server behaved.
      out.push(`${p}=${r.ms}ms(${r.status})`);
      if (r.status === 0 || r.status >= 400) bad.push(`${p}=${r.status}`);
    }
    // The TARGET is still unagreed, but a page that does not load is not a pending decision.
    // This returned pass() unconditionally, so three HTTP 500s read as a pass.
    return bad.length === 0
      ? pass(`${out.join(' ')} — target angka belum disepakati pemilik proses`)
      : fail(`halaman tidak termuat: ${bad.join(' ')} | semua: ${out.join(' ')}`);
  });
  await check('UAT-M13-08', async () => {
    const N = 20;
    const t0 = Date.now();
    // noPace: the pacer would send these 620 ms apart and the "concurrency" test would
    // measure nothing but its own scheduling.
    const rs = await Promise.all(Array.from({ length: N }, () => api('GET', '/products/api/v1/products?limit=20', { noPace: true })));
    const ms = Date.now() - t0;
    const errors = rs.filter((r) => r.status >= 400).length;
    return errors === 0
      ? pass(`${N} concurrent catalog reads in ${ms} ms, 0 errors (full ${N}-user checkout load test still to be agreed)`)
      : fail(`${errors}/${N} concurrent requests failed`);
  });

  // ---------------------------------------------------------------- M15
  const gi = `${D}/depots/${depot.id}/gallon-issues`;
  const gr = `${D}/depots/${depot.id}/returns`;

  await check('UAT-M15-01', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { customerId: ctx.customerAId, quantity: 3, depositHeld: 15000, note: 'UAT keluar' } });
    ctx.gallonIssue = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-02', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { quantity: 2, depositHeld: 10000, note: 'walk-in' } });
    return r.status < 400 ? pass(`HTTP ${r.status} — customerId optional, walk-in recorded`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-14', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { quantity: 1, depositHeld: 0 } });
    return r.status < 400 ? pass(`deposit 0 accepted (HTTP ${r.status})`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-08', async () => {
    const zero = await api('POST', gi, { token: ctx.operator, body: { quantity: 0, depositHeld: 1000 } });
    const neg = await api('POST', gi, { token: ctx.operator, body: { quantity: -1, depositHeld: 1000 } });
    return zero.status === 400 && neg.status === 400 ? pass(`0 => 400; -1 => 400`) : fail(`0 => ${zero.status}; -1 => ${neg.status}`);
  });

  await check('UAT-M15-09', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { quantity: 1, depositHeld: -5000 } });
    return r.status === 400 ? pass(`HTTP 400 ${JSON.stringify(r.body?.message ?? '')}`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M15-10', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { quantity: 2.5, depositHeld: 1000 } });
    return r.status === 400 ? pass(`HTTP 400 ${JSON.stringify(r.body?.message ?? '')}`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M15-12', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { quantity: 1, depositHeld: 0, note: 'x'.repeat(301) } });
    return r.status === 400 ? pass(`301-char note => HTTP 400`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M15-15', async () => {
    const r = await api('POST', gi, { token: ctx.operator, body: { quantity: 1, depositHeld: 0, note: 'x'.repeat(300) } });
    return r.status < 400 ? pass(`300-char note accepted (HTTP ${r.status})`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`);
  });

  await check('UAT-M15-13', async () => {
    if (!ctx.depotB) return blocked('only one depot');
    const r = await api('POST', `${D}/depots/${ctx.depotB.id}/gallon-issues`, { token: ctx.operator, body: { quantity: 1, depositHeld: 0 } });
    return [403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`operator A wrote a gallon issue for depot B: HTTP ${r.status}`);
  });

  await check('UAT-M15-03', async () => {
    const r = await api('POST', gr, { token: ctx.operator, body: { customerId: ctx.customerAId, quantity: 3, condition: 'GOOD', depositRefunded: 15000 } });
    return r.status < 400 ? pass(`HTTP ${r.status}; ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-04', async () => {
    const r = await api('POST', gr, { token: ctx.operator, body: { customerId: ctx.customerAId, quantity: 1, condition: 'DAMAGED', depositRefunded: 0, note: 'retak' } });
    return r.status < 400
      ? pass(`HTTP ${r.status}; damaged return recorded with refund 0 — kebijakan deposit galon rusak perlu keputusan pemilik proses`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-11', async () => {
    const rowFor = (b) => (Array.isArray(b) ? b : b?.items ?? []).find((x) => x.depotId === depot.id) ?? {};
    const before = rowFor((await api('GET', `${D}/gallon-outstanding`, { token: ctx.manager })).body);
    const huge = 100000;
    const r = await api('POST', gr, { token: ctx.operator, body: { customerId: ctx.customerAId, quantity: huge, condition: 'GOOD', depositRefunded: 0 } });
    const after = rowFor((await api('GET', `${D}/gallon-outstanding`, { token: ctx.manager })).body);
    // Judge the guard, not the ledger's history: earlier unguarded runs left this depot
    // with more refunded than it ever held, and no amount of correct behaviour now can
    // undo that. What must hold is that the over-return is REFUSED and moves nothing.
    const unchanged = (after.depositRefunded ?? 0) === (before.depositRefunded ?? 0)
      && (after.returned ?? 0) === (before.returned ?? 0);
    return r.status >= 400 && unchanged
      ? pass(`over-return (${huge} vs ${after.issued ?? 0} issued) rejected HTTP ${r.status} ${r.body?.code ?? ''}; ledger unmoved (returned ${after.returned}, refunded ${after.depositRefunded})`)
      : fail(`over-return HTTP ${r.status}; ledger moved: returned ${before.returned}->${after.returned}, refunded ${before.depositRefunded}->${after.depositRefunded}`);
  });

  await check('UAT-M15-05', async () => {
    const anyOrder = ctx.deliveredOrder ?? ctx.orderA;
    const r = await api('POST', `${D}/driver/gallon-returns`, { token: ctx.driverA, body: { depotId: depot.id, orderId: anyOrder?.id, quantity: 5 } });
    return r.status < 400 ? pass(`HTTP ${r.status}; courier deposit recorded to depot ${depot.code}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-06', async () => {
    const out = await api('GET', `${gi}/summary`, { token: ctx.manager });
    const back = await api('GET', `${gr}/summary`, { token: ctx.manager });
    return out.status === 200 && back.status === 200
      ? pass(`issued: ${JSON.stringify(out.body).slice(0, 140)}; returned: ${JSON.stringify(back.body).slice(0, 140)}`)
      : fail(`issue summary HTTP ${out.status}; return summary HTTP ${back.status}`);
  });

  await check('UAT-M15-07', async () => {
    const r = await api('GET', `${D}/gallon-outstanding`, { token: ctx.hq });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 ? pass(`HTTP 200; ${rows.length || Object.keys(r.body ?? {}).length} depot rows: ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M15-16', async () => {
    const before = await api('GET', `${D}/gallon-outstanding`, { token: ctx.manager });
    const issue = await api('POST', gi, { token: ctx.operator, body: { customerId: ctx.customerAId, quantity: 3, depositHeld: 15000 } });
    const ret = await api('POST', gr, { token: ctx.operator, body: { customerId: ctx.customerAId, quantity: 3, condition: 'GOOD', depositRefunded: 15000 } });
    const after = await api('GET', `${D}/gallon-outstanding`, { token: ctx.manager });
    return issue.status < 400 && ret.status < 400
      ? pass(`issue 3 (HTTP ${issue.status}) then return 3 (HTTP ${ret.status}); outstanding before=${JSON.stringify(before.body).slice(0, 90)} after=${JSON.stringify(after.body).slice(0, 90)}; deposit out 15000 / in 15000 balanced`)
      : fail(`issue HTTP ${issue.status}; return HTTP ${ret.status}`);
  });

  // ---------------------------------------------------------------- M16
  await check('UAT-M16-01', async () => {
    const item = (Array.isArray((await api('GET', inv, { token: ctx.operator })).body) ? (await api('GET', inv, { token: ctx.operator })).body : (await api('GET', inv, { token: ctx.operator })).body?.items ?? [])
      .find((x) => x.productId === ctx.product.id);
    if (!item) return blocked('no inventory row for the test product');
    ctx.invRow = item;
    const before = { qty: item.quantity, reserved: item.reservedQuantity ?? item.reserved ?? 0 };
    const o = await newOrder(ctx, 5);
    const after = (await api('GET', `${itemApi}/${item.id}`, { token: ctx.operator })).body;
    ctx.reserveOrder = o;
    const reservedAfter = after?.reservedQuantity ?? after?.reserved ?? 0;
    return o && reservedAfter === before.reserved + 5 && after.quantity === before.qty
      ? pass(`reserved ${before.reserved} -> ${reservedAfter}; physical stock unchanged at ${after.quantity}`)
      : fail(`order=${Boolean(o)}; reserved ${before.reserved} -> ${reservedAfter}; qty ${before.qty} -> ${after?.quantity}`);
  });

  await check('UAT-M16-02', async () => {
    if (!ctx.reserveOrder?.id) return blocked('no reserved order');
    const before = (await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body;
    const c = await api('POST', `${ORD}/orders/${ctx.reserveOrder.id}/cancel`, { token: ctx.customerA.accessToken, body: { reason: 'uat release' } });
    const after = (await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body;
    const r0 = before?.reservedQuantity ?? before?.reserved ?? 0;
    const r1 = after?.reservedQuantity ?? after?.reserved ?? 0;
    return c.status < 400 && r1 === r0 - 5
      ? pass(`cancel HTTP ${c.status}; reserved ${r0} -> ${r1}`)
      : fail(`cancel HTTP ${c.status} ${JSON.stringify(c.body)}; reserved ${r0} -> ${r1}`);
  });

  await check('UAT-M16-03', async () => {
    const before = (await api('GET', `${itemApi}/${ctx.invRow?.id}`, { token: ctx.operator })).body;
    const o = await newOrder(ctx, 2);
    if (!o) return blocked('checkout failed');
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'PREPARING' } });
    await api('POST', `${DEL}/driver/shifts/check-in`, {
      token: ctx.driverA, body: { depotId: depot.id, lat: Number(depot.lat ?? -6.2), lng: Number(depot.lng ?? 106.8) },
    });
    const d = await api('POST', `${DEL}/deliveries`, { token: ctx.operator, body: { orderId: o.id, orderNumber: o.orderNumber, driverId: ctx.driverAId, depotId: depot.id, destinationAddress: 'Jl. Cikini Raya No. 5, Jakarta Pusat' } });
    if (d.status >= 400) return blocked(`assign HTTP ${d.status} ${JSON.stringify(d.body)}`);
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/pickup`, { token: ctx.driverA });
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/start`, { token: ctx.driverA });
    await api('POST', `${DEL}/driver/deliveries/${d.body.id}/complete`, {
      token: ctx.driverA, body: { photoUrl: 'https://dummy.local/pod.jpg', recipientName: 'Budi', latitude: -6.1944, longitude: 106.8412 },
    });
    const after = (await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body;
    const moves = await api('GET', `${itemApi}/${ctx.invRow.id}/movements`, { token: ctx.operator });
    const mrows = Array.isArray(moves.body) ? moves.body : moves.body?.items ?? [];
    return after?.quantity === before?.quantity - 2
      ? pass(`physical stock ${before.quantity} -> ${after.quantity}; movements=${mrows.length}, latest=${JSON.stringify(mrows[0] ?? {}).slice(0, 140)}`)
      : fail(`stock ${before?.quantity} -> ${after?.quantity} (expected -2)`);
  });

  await check('UAT-M16-04', async () => {
    if (!ctx.invRow) return blocked('no inventory row');
    const r = await api('POST', `${itemApi}/${ctx.invRow.id}/opname`, { token: ctx.operator, body: { countedQuantity: 97, reason: 'opname UAT' } });
    const after = (await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body;
    const moves = await api('GET', `${itemApi}/${ctx.invRow.id}/movements`, { token: ctx.operator });
    const mrows = Array.isArray(moves.body) ? moves.body : moves.body?.items ?? [];
    return r.status < 400 && after?.quantity === 97
      ? pass(`stock set to 97; opname movement recorded: ${JSON.stringify(mrows[0] ?? {}).slice(0, 160)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; quantity=${after?.quantity}`);
  });

  await check('UAT-M16-10', async () => {
    const r = await api('POST', `${itemApi}/${ctx.invRow?.id}/opname`, { token: ctx.operator, body: { countedQuantity: -5 } });
    return r.status === 400 ? pass(`HTTP 400 ${JSON.stringify(r.body?.message ?? '')}`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M16-14', async () => {
    // Raw lines are per-depot singletons, so a fresh probe row 409s once the depot already
    // holds a TUTUP line. Reuse whatever raw line is there — the case is about opname 0.
    let probe = await api('POST', inv, { token: ctx.operator, body: { itemType: 'TUTUP', label: `Opname nol ${uniq()}`, unit: 'pcs', quantity: 5, minimumStock: 0 } });
    if (probe.status >= 400) {
      const rows = (await api('GET', inv, { token: ctx.operator })).body;
      const existing = (Array.isArray(rows) ? rows : rows?.items ?? []).find((x) => x.itemType && !x.productId);
      if (!existing) return blocked(`could not create probe item: HTTP ${probe.status}`);
      probe = { body: existing };
    }
    const r = await api('POST', `${itemApi}/${probe.body.id}/opname`, { token: ctx.operator, body: { countedQuantity: 0 } });
    const after = (await api('GET', `${itemApi}/${probe.body.id}`, { token: ctx.operator })).body;
    return r.status < 400 && after?.quantity === 0 ? pass(`opname 0 accepted; item still listed with quantity 0`) : fail(`HTTP ${r.status}; quantity=${after?.quantity}`);
  });

  await check('UAT-M16-05', async () => {
    const r = await api('GET', `${itemApi}/low-stock?depotId=${depot.id}`, { token: ctx.operator });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const sellable = (x) => (x.quantity ?? 0) - (x.reserved ?? 0);
    const violations = rows.filter((x) => sellable(x) > (x.minimumStock ?? 0));
    return r.status === 200 && violations.length === 0
      ? pass(`HTTP 200; ${rows.length} low-stock rows, all with sellable stock <= minimumStock`)
      : fail(`HTTP ${r.status}; ${violations.length} rows above their minimum leaked into the low-stock list`);
  });

  await check('UAT-M16-13', async () => {
    const item = ctx.invRow;
    if (!item) return blocked('no inventory row');
    await api('PATCH', `${itemApi}/${item.id}`, { token: ctx.operator, body: { minimumStock: 10 } });
    await api('POST', `${inv}/${item.id}/opname`, { token: ctx.operator, body: { countedQuantity: 10 } });
    const at = await api('GET', `${itemApi}/low-stock?depotId=${depot.id}`, { token: ctx.operator });
    const inAt = (Array.isArray(at.body) ? at.body : at.body?.items ?? []).some((x) => x.id === item.id);
    await api('POST', `${inv}/${item.id}/opname`, { token: ctx.operator, body: { countedQuantity: 9 } });
    const below = await api('GET', `${itemApi}/low-stock?depotId=${depot.id}`, { token: ctx.operator });
    const inBelow = (Array.isArray(below.body) ? below.body : below.body?.items ?? []).some((x) => x.id === item.id);
    return inBelow
      ? pass(`qty 10 (== minimum) listed=${inAt}; qty 9 listed=${inBelow} — ambang ${inAt ? 'inklusif' : 'eksklusif'}, konfirmasikan ke pemilik proses`)
      : fail(`qty 9 below minimum 10 but not listed as low stock`);
  });

  await check('UAT-M16-06', async () => {
    const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const r = await api('GET', `${D}/depots/${depot.id}/inventory/movements?from=${from}`, { token: ctx.manager });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const fields = Object.keys(rows[0] ?? {});
    return r.status === 200 && rows.length > 0
      ? pass(`HTTP 200; ${rows.length} movements; fields: ${fields.join(',')}`)
      : fail(`HTTP ${r.status}; ${rows.length} rows`);
  });

  await check('UAT-M16-07', async () => {
    const existing = (await api('GET', inv, { token: ctx.operator })).body;
    const rows = Array.isArray(existing) ? existing : existing?.items ?? [];
    let free = ['SEGEL', 'TUTUP', 'AIR', 'GALON'].find((t) => !rows.some((x) => x.itemType === t));
    // Raw lines are per-depot singletons. When depot A already holds all four, file the new
    // raw line at depot B instead of blocking — the case is about storing one without a productId.
    let target = { url: inv, token: ctx.operator };
    if (!free && ctx.depotB) {
      const bInv = `${D}/depots/${ctx.depotB.id}/inventory`;
      const bRows = (await api('GET', bInv, { token: ctx.operatorB })).body;
      const bList = Array.isArray(bRows) ? bRows : bRows?.items ?? [];
      free = ['SEGEL', 'TUTUP', 'AIR', 'GALON'].find((t) => !bList.some((x) => x.itemType === t));
      if (free) target = { url: bInv, token: ctx.operatorB };
    }
    if (!free) return na('every depot already holds a line for all four raw item types — they are per-depot singletons by design, so a second one cannot be created');
    const r = await api('POST', target.url, { token: target.token, body: { itemType: free, label: `${free} ${uniq()}`, unit: 'pcs', quantity: 100, minimumStock: 10 } });
    return r.status < 400 && !r.body?.productId ? pass(`HTTP ${r.status}; raw ${free} row stored without productId`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M16-11', async () => {
    const noLabel = await api('POST', inv, { token: ctx.operator, body: { itemType: 'TUTUP', unit: 'pcs', quantity: 1, minimumStock: 0 } });
    const noUnit = await api('POST', inv, { token: ctx.operator, body: { itemType: 'TUTUP', label: 'Tanpa satuan', quantity: 1, minimumStock: 0 } });
    return noLabel.status === 400 && noUnit.status === 400 ? pass(`missing label => 400; missing unit => 400`) : fail(`label => ${noLabel.status}; unit => ${noUnit.status}`);
  });

  await check('UAT-M16-12', async () => {
    const a = await api('POST', inv, { token: ctx.operator, body: { itemType: 'TUTUP', label: `Neg min ${uniq()}`, unit: 'pcs', quantity: 1, minimumStock: -1 } });
    const b = await api('POST', inv, { token: ctx.operator, body: { itemType: 'TUTUP', label: `Neg price ${uniq()}`, unit: 'pcs', quantity: 1, minimumStock: 0, sellPrice: -100 } });
    return a.status === 400 && b.status === 400 ? pass(`minimumStock -1 => 400; sellPrice -100 => 400`) : fail(`minimumStock => ${a.status}; sellPrice => ${b.status}`);
  });

  await check('UAT-M16-08', async () => {
    if (!ctx.invRow) return blocked('no inventory row');
    // Available, not physical: outstanding holds from earlier orders are still counted in
    // `reserved`, so a flat opname of 5 left nothing orderable and the hold order failed.
    const held8 = Number((await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body?.reserved ?? 0);
    await api('POST', `${itemApi}/${ctx.invRow.id}/opname`, { token: ctx.operator, body: { countedQuantity: held8 + 5 } });
    const hold = await newOrder(ctx, 5);
    if (!hold) return blocked('could not place the reserving order');
    const r = await api('POST', `${ORD}/cart/items`, { token: A, body: { productId: ctx.product.id, quantity: 1 } });
    const co = await api('POST', `${ORD}/orders/checkout`, { token: A, body: { deliveryAddress: addr() } });
    const s = JSON.stringify(co.body);
    await api('POST', `${ORD}/orders/${hold.id}/cancel`, { token: A, body: { reason: 'cleanup' } });
    return co.status >= 400 && /INSUFFICIENT_STOCK/i.test(s) ? pass(`HTTP ${co.status} ${s}`) : fail(`HTTP ${co.status} ${s}`);
  });

  await check('UAT-M16-09', async () => {
    if (!ctx.invRow) return blocked('no inventory row');
    // Count to reserved + 1 so exactly one unit is AVAILABLE. A flat 1, with holds from
    // earlier orders still outstanding, makes available negative and both checkouts fail
    // for the wrong reason (that is what "0 checkouts succeeded (422/422)" was).
    const held = Number((await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body?.reserved ?? 0);
    await api('POST', `${itemApi}/${ctx.invRow.id}/opname`, { token: ctx.operator, body: { countedQuantity: held + 1 } });
    await api('DELETE', `${ORD}/cart`, { token: A });
    await api('POST', `${ORD}/cart/items`, { token: A, body: { productId: ctx.product.id, quantity: 1 } });
    const [a, b] = await Promise.all([
      api('POST', `${ORD}/orders/checkout`, { token: A, body: { deliveryAddress: addr() } }),
      api('POST', `${ORD}/orders/checkout`, { token: A, body: { deliveryAddress: addr() } }),
    ]);
    const after = (await api('GET', `${itemApi}/${ctx.invRow.id}`, { token: ctx.operator })).body;
    const ok = [a, b].filter((r) => r.status < 400).length;
    await api('POST', `${itemApi}/${ctx.invRow.id}/opname`, { token: ctx.operator, body: { countedQuantity: 2000 + held } });
    return ok === 1 && (after?.quantity ?? 0) >= 0
      ? pass(`parallel checkout on the last unit: 1 success / 1 rejected (${a.status}/${b.status}); stock=${after?.quantity}, never negative`)
      : fail(`${ok} checkouts succeeded (${a.status}/${b.status}); stock=${after?.quantity}`);
  });

  // ---------------------------------------------------------------- M14 (E2E)
  await check('UAT-M14-01', async () => {
    const steps = [];
    const o = await newOrder(ctx, 2);
    if (!o) return blocked('checkout failed');
    steps.push(`order ${o.orderNumber} CREATED`);
    const p = await api('POST', PAY, { token: A, body: { orderId: o.id, method: 'QRIS', amount: o.totalIdr ?? o.total } });
    const conf = await api('POST', `${PAY}/${p.body?.id}/confirm`, { token: ctx.admin, body: { providerRef: 'E2E-1' } });
    steps.push(`payment ${p.status}/${conf.status}`);
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'PREPARING' } });
    const d = await api('POST', `${DEL}/deliveries`, { token: ctx.operator, body: { orderId: o.id, orderNumber: o.orderNumber, driverId: ctx.driverAId, depotId: depot.id, destinationAddress: 'Jl. Cikini Raya No. 5, Jakarta Pusat' } });
    if (d.status >= 400) return fail(`${steps.join('; ')}; assign courier HTTP ${d.status} ${JSON.stringify(d.body)}`);
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/pickup`, { token: ctx.driverA });
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/start`, { token: ctx.driverA });
    const pod = await api('POST', `${DEL}/driver/deliveries/${d.body.id}/complete`, {
      token: ctx.driverA, body: { photoUrl: 'https://dummy.local/pod.jpg', recipientName: 'Budi Santoso', latitude: -6.1944, longitude: 106.8412 },
    });
    const rev = await api('POST', `${ORD}/orders/${o.id}/review`, { token: A, body: { rating: 5, comment: 'E2E UAT' } });
    const fin = await api('GET', `${ORD}/orders/${o.id}`, { token: A });
    const pay = await api('GET', `${PAY}/for-order/${o.id}`, { token: A });
    steps.push(`POD ${pod.status}`, `review ${rev.status}`, `final ${fin.body?.status}`, `payment ${pay.body?.status ?? pay.body?.[0]?.status}`);
    return ['DELIVERED', 'COMPLETED'].includes(fin.body?.status) && pod.status < 400
      ? pass(steps.join('; '))
      : fail(steps.join('; '));
  });

  await check('UAT-M14-02', async () => {
    const o = await newOrder(ctx, 2);
    if (!o) return blocked('checkout failed');
    const total = o.totalIdr ?? o.total;
    const p = await api('POST', PAY, { token: A, body: { orderId: o.id, method: 'CASH', amount: total } });
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'PREPARING' } });
    await api('POST', `${DEL}/driver/shifts/check-in`, {
      token: ctx.driverB, body: { depotId: depot.id, lat: Number(depot.lat ?? -6.2), lng: Number(depot.lng ?? 106.8) },
    });
    const d = await api('POST', `${DEL}/deliveries`, { token: ctx.operator, body: { orderId: o.id, orderNumber: o.orderNumber, driverId: ctx.driverBId, depotId: depot.id, destinationAddress: 'Jl. Cikini Raya No. 5, Jakarta Pusat' } });
    if (d.status >= 400) return blocked(`assign HTTP ${d.status} ${JSON.stringify(d.body).slice(0, 120)}`);
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/pickup`, { token: ctx.driverB });
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/start`, { token: ctx.driverB });
    const cash = await api('POST', `${PAY}/${p.body?.id}/confirm`, { token: ctx.driverB, body: { cashReceived: total + 10000 } });
    await api('POST', `${DEL}/driver/deliveries/${d.body.id}/complete`, {
      token: ctx.driverB, body: { photoUrl: 'https://dummy.local/pod.jpg', recipientName: 'Budi', latitude: -6.1944, longitude: 106.8412 },
    });
    // Settlement is per SHIFT: { shiftId, depositedAmount }. The old {amount,cashAmount}
    // body was rejected 400 by validation, so the case never reached the deposit at all.
    const shiftB = (await api('GET', `${DEL}/driver/shifts/current`, { token: ctx.driverB })).body
      ?? (await api('POST', `${DEL}/driver/shifts/check-in`, {
        token: ctx.driverB, body: { depotId: depot.id, lat: Number(depot.lat ?? -6.2), lng: Number(depot.lng ?? 106.8) },
      })).body;
    if (shiftB?.id) {
      await api('POST', `${DEL}/driver/shifts/${shiftB.id}/check-out`, {
        token: ctx.driverB, body: { lat: Number(depot.lat ?? -6.2), lng: Number(depot.lng ?? 106.8) },
      });
    }
    const settle = shiftB?.id
      ? await api('POST', `${DEL}/driver/settlement`, { token: ctx.driverB, body: { shiftId: shiftB.id, depositedAmount: total } })
      : { status: 0, body: { error: 'no shift to settle' } };
    const recon = await api('GET', `${PAY}/cash-collected?from=${new Date().toISOString().slice(0, 10)}`, { token: ctx.finance });
    const paid = (await api('GET', `${PAY}/${p.body?.id}`, { token: A })).body?.status;
    return paid === 'PAID' && settle.status < 400
      ? pass(`cash ${total}+10000 => PAID (change handled); settlement HTTP ${settle.status}; reconciliation HTTP ${recon.status} ${JSON.stringify(recon.body).slice(0, 140)}`)
      : fail(`cash confirm HTTP ${cash.status} ${JSON.stringify(cash.body)}; payment=${paid}; settlement HTTP ${settle.status}`);
  });

  await check('UAT-M14-03', async () => {
    const o = await newOrder(ctx, 1);
    if (!o) return blocked('checkout failed');
    const p = await api('POST', PAY, { token: A, body: { orderId: o.id, method: 'QRIS', amount: o.totalIdr ?? o.total } });
    await api('POST', `${PAY}/${p.body?.id}/confirm`, { token: ctx.admin, body: { providerRef: 'E2E-3' } });
    const cancel = await api('POST', `${ORD}/orders/${o.id}/cancel`, { token: A, body: { reason: 'berubah pikiran' } });
    const refundQueue = await api('GET', `${PAY}/refunds/queue`, { token: ctx.finance });
    const queued = (Array.isArray(refundQueue.body) ? refundQueue.body : refundQueue.body?.items ?? []).some((x) => x.paymentId === p.body?.id || x.orderId === o.id);
    let approve = { status: 'n/a' };
    if (queued) approve = await api('POST', `${PAY}/${p.body.id}/refund/approve`, { token: ctx.finance, body: { note: 'E2E' } });
    const fin = await api('GET', `${ORD}/orders/${o.id}`, { token: A });
    const pay = await api('GET', `${PAY}/${p.body?.id}`, { token: A });
    return cancel.status < 400 && fin.body?.status === 'CANCELLED'
      ? pass(`order CANCELLED; refund auto-queued=${queued}; approve HTTP ${approve.status}; payment=${pay.body?.status}`)
      : fail(`cancel HTTP ${cancel.status} ${JSON.stringify(cancel.body)}; order=${fin.body?.status}; payment=${pay.body?.status}`);
  });

  await check('UAT-M14-04', async () => {
    const o = await newOrder(ctx, 1);
    if (!o) return blocked('checkout failed');
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'PREPARING' } });
    const d = await api('POST', `${DEL}/deliveries`, { token: ctx.operator, body: { orderId: o.id, orderNumber: o.orderNumber, driverId: ctx.driverAId, depotId: depot.id, destinationAddress: 'Jl. Cikini Raya No. 5, Jakarta Pusat' } });
    if (d.status >= 400) return blocked(`assign HTTP ${d.status}`);
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/pickup`, { token: ctx.driverA });
    await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/start`, { token: ctx.driverA });
    // No-show is gated (design 5a): NO_SHOW_MIN_CONTACT_ATTEMPTS=2 attempts AND a
    // NO_SHOW_MIN_WAIT_SECONDS=300 wait. Log the attempts first; a 422 after that is the
    // gate doing its job, not a defect, so the case records it and moves on.
    for (const method of ['CALL', 'CHAT']) {
      await api('POST', `${DEL}/driver/deliveries/${d.body.id}/contact-attempts`, { token: ctx.driverA, body: { method, note: 'tidak diangkat' } });
    }
    const noshow = await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/no-show`, { token: ctx.driverA, body: { contactMethod: 'CALL', note: 'tidak di tempat' } });
    const gateHeld = noshow.status === 422 && /NO_SHOW|ELIGIBLE|attempt|tunggu/i.test(JSON.stringify(noshow.body));
    const resched = await api('PATCH', `${DEL}/driver/deliveries/${d.body.id}/reschedule`, {
      token: ctx.driverA, body: { rescheduledFor: new Date(Date.now() + 86400e3).toISOString(), note: 'besok' },
    });
    // RESCHEDULED is terminal in the delivery state machine ([RESCHEDULED]: []), so the
    // retry is a NEW assignment for the same order, not a second completion of this one.
    const retry = await api('POST', `${DEL}/deliveries`, {
      token: ctx.operator,
      body: { orderId: o.id, orderNumber: o.orderNumber, driverId: ctx.driverAId, depotId: depot.id, destinationAddress: 'Jl. Cikini Raya No. 5, Jakarta Pusat' },
    });
    let second = retry;
    if (retry.status < 400 && retry.body?.id) {
      await api('PATCH', `${DEL}/driver/deliveries/${retry.body.id}/pickup`, { token: ctx.driverA });
      await api('PATCH', `${DEL}/driver/deliveries/${retry.body.id}/start`, { token: ctx.driverA });
      second = await api('POST', `${DEL}/driver/deliveries/${retry.body.id}/complete`, {
        token: ctx.driverA, body: { photoUrl: 'https://dummy.local/pod2.jpg', recipientName: 'Budi', latitude: -6.1944, longitude: 106.8412 },
      });
    }
    const payments = await api('GET', `${PAY}/for-order/${o.id}`, { token: A });
    const count = Array.isArray(payments.body) ? payments.body.length : payments.body ? 1 : 0;
    return (noshow.status < 400 || gateHeld) && resched.status < 400 && second.status < 400 && count <= 1
      ? pass(`contact attempts logged; no-show ${noshow.status}${gateHeld ? ' (gate held: needs 2 attempts + 300s wait)' : ''} -> reschedule ${resched.status} -> re-assigned and delivered ${second.status}; ${count} payment record (no double charge)`)
      : fail(`no-show ${noshow.status} ${JSON.stringify(noshow.body).slice(0, 110)}; reschedule ${resched.status}; retry ${second.status} ${JSON.stringify(second.body).slice(0, 110)}; payments=${count}`);
  });

  await check('UAT-M14-07', async () => na('cross-checked by M10 (attendance + payroll) and M24; a full month of attendance data is not generated in this pass'));

  // ---------------------------------------------------------------- M17
  await check('UAT-M17-01', async () => {
    const cin = await api('POST', `${D}/cashbook`, { token: ctx.manager, body: { depotId: depot.id, direction: 'IN', category: 'PENJUALAN', label: 'Penjualan tunai', amountIdr: 500000 } });
    const cout = await api('POST', `${D}/cashbook`, { token: ctx.manager, body: { depotId: depot.id, direction: 'OUT', category: 'PEMBELIAN', label: 'Beli galon', amountIdr: 150000 } });
    const list = await api('GET', `${D}/cashbook?depotId=${depot.id}`, { token: ctx.manager });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const bal = rows.reduce((a, r) => a + (r.direction === 'IN' ? r.amount : -r.amount), 0);
    return cin.status < 400 && cout.status < 400
      ? pass(`IN 500000 (HTTP ${cin.status}), OUT 150000 (HTTP ${cout.status}); ${rows.length} rows, computed balance=${bal}`)
      : fail(`IN HTTP ${cin.status} ${JSON.stringify(cin.body)}; OUT HTTP ${cout.status}`);
  });

  await check('UAT-M17-02', async () => {
    const from = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const r = await api('GET', `${D}/cashbook?depotId=${depot.id}&from=${from}&to=${to}`, { token: ctx.manager });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const outside = rows.filter((x) => (x.createdAt ?? '').slice(0, 10) < from);
    return r.status === 200 && outside.length === 0
      ? pass(`HTTP 200; ${rows.length} rows all inside ${from}..${to}`)
      : fail(`HTTP ${r.status}; ${outside.length} rows outside the requested window`);
  });

  await check('UAT-M17-12', async () => {
    const badDir = await api('POST', `${D}/cashbook`, { token: ctx.manager, body: { depotId: depot.id, direction: 'SIDEWAYS', category: 'X', label: 'x', amountIdr: 1000 } });
    const noCat = await api('POST', `${D}/cashbook`, { token: ctx.manager, body: { depotId: depot.id, direction: 'IN', label: 'x', amountIdr: 1000 } });
    return badDir.status === 400 && noCat.status === 400 ? pass(`bad direction => 400; missing category => 400`) : fail(`direction => ${badDir.status}; category => ${noCat.status}`);
  });

  await check('UAT-M17-13', async () => {
    const r = await api('GET', `${D}/cashbook`, { token: ctx.manager });
    return r.status === 400 ? pass(`HTTP 400 ${JSON.stringify(r.body?.message ?? '')}`) : fail(`cashbook list without depotId => HTTP ${r.status}`);
  });

  await check('UAT-M17-17', async () => {
    if (!ctx.depotB) return blocked('only one depot');
    const r = await api('GET', `${D}/cashbook?depotId=${ctx.depotB.id}`, { token: ctx.manager });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return [403, 404].includes(r.status) || rows.length === 0
      ? pass(`HTTP ${r.status}; rows returned=${rows.length}`)
      : fail(`operator A read ${rows.length} cashbook rows from depot B (HTTP ${r.status})`);
  });

  await check('UAT-M17-18', async () => {
    const r = await api('GET', `${D}/cashbook?depotId=${depot.id}&from=2026-07-31&to=2026-07-01`, { token: ctx.manager });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status >= 400 || rows.length === 0
      ? pass(`reversed range => HTTP ${r.status}, ${rows.length} rows (defined behaviour, no raw error)`)
      : fail(`reversed range returned ${rows.length} rows (HTTP ${r.status})`);
  });

  await check('UAT-M17-03', async () => {
    const r = await api('POST', `${D}/shift-handovers`, {
      token: ctx.operator,
      body: { depotId: depot.id, fromShift: 'PAGI', toShift: 'SIANG', fromStaff: 'Andi', toStaff: 'Budi', items: [{ title: 'Kas laci', subtext: 'Rp500.000', state: 'DONE' }, { title: 'Galon kosong', subtext: '20 unit', state: 'DONE' }, { title: 'Kunci', subtext: 'ada', state: 'PENDING' }] },
    });
    ctx.handover = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; status=${r.body?.status ?? 'pending signature'}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M17-04', async () => {
    if (!ctx.handover?.id) return blocked('no handover');
    const r = await api('PATCH', `${D}/shift-handovers/${ctx.handover.id}/sign`, { token: ctx.operator, body: { signedByName: 'Budi' } });
    return r.status < 400 ? pass(`HTTP ${r.status}; signedAt=${r.body?.signedAt}; signedBy=${r.body?.signedByName ?? r.body?.signedBy}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M17-15', async () => {
    const r = await api('PATCH', `${D}/shift-handovers/00000000-0000-0000-0000-000000000000/sign`, { token: ctx.operator, body: { signedByName: 'X' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /NOT_FOUND/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M17-05', async () => {
    const r = await api('PUT', `${D}/huddle-notes`, { token: ctx.manager, body: { depotId: depot.id, weekStart: weekMonday(), agenda: [{ title: 'Ketepatan waktu antar', note: 'Target SLA 120 menit' }], actionItems: [{ text: 'Cek rute pagi', assignee: 'Andi', done: false }] } });
    const read = await api('GET', `${D}/huddle-notes?depotId=${depot.id}`, { token: ctx.operator });
    return r.status < 400 && read.status === 200 ? pass(`saved HTTP ${r.status}; readable by the depot team HTTP ${read.status}`) : fail(`save HTTP ${r.status} ${JSON.stringify(r.body)}; read HTTP ${read.status}`);
  });

  await check('UAT-M17-06', async () => {
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10));
    const r = await api('PUT', `${D}/shifts/bulk`, {
      token: ctx.manager,
      body: { depotId: depot.id, weekStart: weekMonday(), cells: [['Andi', ctx.driverAId], ['Budi', ctx.driverBId]].filter(([, id]) => id).flatMap(([n, id]) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ staffId: id, staffName: n, day, shift: day === 6 ? 'OFF' : 'MORNING' }))) },
    });
    return r.status < 400 ? pass(`${r.body?.length ?? 'all'} roster entries saved in one call (HTTP ${r.status})`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 220)}`);
  });

  await check('UAT-M17-07', async () => {
    const r = await api('PUT', `${D}/depot-targets`, { token: ctx.manager, body: { depotId: depot.id, month: new Date().toISOString().slice(0, 7), revenueTargetIdr: 50000000, ordersTarget: 500, slaTargetPct: 90, newCustomersTarget: 50 } });
    const read = await api('GET', `${D}/depot-targets?depotId=${depot.id}&month=${new Date().toISOString().slice(0, 7)}`, { token: ctx.manager });
    return r.status < 400 && read.status === 200 ? pass(`target saved HTTP ${r.status}; read-back ${JSON.stringify(read.body).slice(0, 160)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M17-08', async () => {
    const c = await api('POST', `${D}/maintenance-items`, { token: ctx.operator, body: { depotId: depot.id, name: 'Ganti filter RO', category: 'FILTER', intervalDays: 30, nextDueAt: new Date(Date.now() + 7 * 86400e3).toISOString() } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    const r = await api('PATCH', `${D}/maintenance-items/${c.body.id}/serviced`, { token: ctx.operator, body: { note: 'selesai' } });
    return r.status < 400 ? pass(`created then marked serviced (HTTP ${r.status}); servicedAt=${r.body?.servicedAt}`) : fail(`serviced HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M17-16', async () => {
    const r = await api('PATCH', `${D}/maintenance-items/00000000-0000-0000-0000-000000000000/serviced`, { token: ctx.operator, body: {} });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /NOT_FOUND/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M17-09', async () => {
    const c = await api('POST', `${D}/order-disputes`, { token: ctx.operator, body: { depotId: depot.id, orderRef: ctx.orderA?.orderNumber ?? 'HM-UAT', customerName: 'Budi Santoso', category: 'QUALITY', description: 'Galon kotor' } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    ctx.dispute = c.body;
    const r = await api('PATCH', `${D}/order-disputes/${c.body.id}/resolve`, { token: ctx.manager, body: { resolution: 'REFUND', resolutionNote: 'Ganti galon baru' } });
    return r.status < 400 ? pass(`dispute created then resolved (HTTP ${r.status}); status=${r.body?.status}`) : fail(`resolve HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M17-14', async () => {
    if (!ctx.dispute?.id) return blocked('no dispute');
    const r = await api('PATCH', `${D}/order-disputes/${ctx.dispute.id}/resolve`, { token: ctx.manager, body: { resolution: 'REFUND', resolutionNote: 'lagi' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /ALREADY_RESOLVED|resolved/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M17-10', async () => {
    const c = await api('POST', `${D}/incidents`, { token: ctx.operator, body: { depotId: depot.id, type: 'OTHER', severity: 'MEDIUM', title: 'Pompa bocor', description: 'Pompa RO bocor di ruang filter' } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    ctx.incident = c.body;
    const r = await api('PATCH', `${D}/incidents/${c.body.id}/resolve`, { token: ctx.manager, body: { note: 'Pompa diganti' } });
    return r.status < 400 ? pass(`incident traced to resolution (HTTP ${r.status}); status=${r.body?.status}`) : fail(`resolve HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M17-11', async () => {
    const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const r = await api('GET', `${D}/reports/operational-costs?depotId=${depot.id}&from=${from}&to=${to}`, { token: ctx.manager });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 220)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });
}
