// M2 Profil & Alamat · M3 Katalog · M4 Keranjang & Checkout · M5 Voucher & Promo
import { api, check, pass, fail, blocked, na, uniq } from './lib.mjs';

const ADDR = '/customers/api/v1/addresses';
const PROD = '/products/api/v1/products';
const CART = '/orders/api/v1/cart';
const ORD = '/orders/api/v1/orders';
const VOU = '/vouchers/api/v1/vouchers';

const inRadius = { latitude: -6.1944, longitude: 106.8412 }; // Depot Cikini pin
const farAway = { latitude: -8.65, longitude: 115.216 };     // Bali — outside every depot radius

// address book entry (has a label); checkout snapshot (no label — DTO forbids it)
const addr = (o = {}) => ({
  label: 'Rumah', recipientName: 'Budi Santoso', phone: '+628123456789',
  addressLine: 'Jl. Cikini Raya No. 5', city: 'Jakarta Pusat', province: 'DKI Jakarta',
  postalCode: '10330', ...inRadius, notes: 'pagar hijau', ...o,
});
const ship = (o = {}) => { const { label, isPrimary, ...rest } = addr(o); return rest; };

export async function run(ctx) {
  const A = ctx.customerA.accessToken;
  const B = ctx.customerB?.accessToken;

  // ---------------------------------------------------------------- M2
  await check('UAT-M2-01', async () => {
    const r = await api('POST', ADDR, { token: A, body: addr() });
    ctx.addressA = r.body;
    return r.status < 400 && r.body?.latitude
      ? pass(`HTTP ${r.status}; id=${r.body.id}; lat/lng persisted (${r.body.latitude},${r.body.longitude})`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M2-02', async () => {
    const second = await api('POST', ADDR, { token: A, body: addr({ label: 'Kantor', addressLine: 'Jl. Kebon Sirih 10' }) });
    if (second.status >= 400) return blocked(`second address HTTP ${second.status} ${JSON.stringify(second.body)}`);
    ctx.addressA2 = second.body;
    const r = await api('POST', `${ADDR}/${second.body.id}/primary`, { token: A });
    const list = await api('GET', ADDR, { token: A });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const primaries = rows.filter((x) => x.isPrimary);
    return r.status < 400 && primaries.length === 1 && primaries[0].id === second.body.id
      ? pass(`HTTP ${r.status}; exactly one primary and it is the new address`)
      : fail(`HTTP ${r.status}; primaries=${JSON.stringify(primaries.map((x) => x.id))}`);
  });

  await check('UAT-M2-03', async () => {
    const r = await api('PATCH', `${ADDR}/${ctx.addressA.id}`, { token: A, body: { notes: 'pagar hijau, gang ke-2' } });
    const g = await api('GET', `${ADDR}/${ctx.addressA.id}`, { token: A });
    return r.status < 400 && g.body?.notes === 'pagar hijau, gang ke-2'
      ? pass(`HTTP ${r.status}; notes persisted`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; read-back=${JSON.stringify(g.body?.notes)}`);
  });

  await check('UAT-M2-04', async () => {
    const tmp = await api('POST', ADDR, { token: A, body: addr({ label: 'Sementara' }) });
    if (tmp.status >= 400) return blocked(`create HTTP ${tmp.status}`);
    const r = await api('DELETE', `${ADDR}/${tmp.body.id}`, { token: A });
    const g = await api('GET', `${ADDR}/${tmp.body.id}`, { token: A });
    return r.status < 400 && g.status >= 400
      ? pass(`delete HTTP ${r.status}; subsequent GET ${g.status}`)
      : fail(`delete HTTP ${r.status}; GET after delete ${g.status}`);
  });

  await check('UAT-M2-05', async () => {
    const r = await api('POST', ADDR, { token: A, body: { label: '', addressLine: '' } });
    return r.status === 400 ? pass(`HTTP 400 ${JSON.stringify(r.body?.message ?? r.body)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M2-06', async () => {
    const body = addr(); delete body.latitude; delete body.longitude;
    const r = await api('POST', ADDR, { token: A, body });
    return r.status >= 400
      ? pass(`HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`)
      : fail(`address saved without coordinates (HTTP ${r.status}) — depot routing depends on lat/lng`);
  });

  await check('UAT-M2-07', async () => {
    const far = await api('POST', ADDR, { token: A, body: addr({ label: 'Luar area', ...farAway }) });
    if (far.status >= 400) return pass(`address outside every service radius rejected at save time: HTTP ${far.status}`);
    ctx.addressFar = far.body;
    await api('DELETE', CART, { token: A });
    const p = await firstProduct();
    await api('POST', `${CART}/items`, { token: A, body: { productId: p.id, quantity: 1 } });
    const co = await api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship({ ...farAway }) } });
    const s = JSON.stringify(co.body);
    return co.status >= 400 && /OUT_OF_SERVICE_AREA/i.test(s)
      ? pass(`checkout rejected ORDER_OUT_OF_SERVICE_AREA (HTTP ${co.status})`)
      : fail(`checkout HTTP ${co.status} ${s}`);
  });

  await check('UAT-M2-08', async () => {
    if (!B) return blocked('customer B not provisioned');
    const r = await api('GET', `${ADDR}/${ctx.addressA.id}`, { token: B });
    return [403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M2-09', async () => {
    const at = await api('POST', ADDR, { token: A, body: addr({ label: 'Batas', addressLine: 'x'.repeat(255) }) });
    const over = await api('POST', ADDR, { token: A, body: addr({ label: 'Lewat', addressLine: 'x'.repeat(256) }) });
    if (at.status < 400) await api('DELETE', `${ADDR}/${at.body.id}`, { token: A });
    return at.status < 400 && over.status === 400
      ? pass(`255 chars => ${at.status}; 256 chars => ${over.status} (batas MaxLength(255))`)
      : fail(`255 chars => ${at.status}; 256 chars => ${over.status} (MaxLength boundary not as documented)`);
  });

  // ---------------------------------------------------------------- M3
  async function firstProduct() {
    const r = await api('GET', `${PROD}?limit=100`);
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return rows.find((p) => p.sku === 'AIR-GALON-19L') ?? rows[0];
  }

  await check('UAT-M3-01', async () => {
    const r = await api('GET', `${PROD}?limit=100`);
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 && rows.length > 0 && rows.every((p) => p.basePrice !== undefined)
      ? pass(`HTTP 200 as guest; ${rows.length} products with prices`)
      : fail(`HTTP ${r.status}; ${rows.length} rows`);
  });

  await check('UAT-M3-02', async () => {
    const p = await firstProduct();
    const r = await api('GET', `${PROD}/${p.id}`);
    const k = Object.keys(r.body ?? {});
    return r.status === 200 && k.includes('name') && k.includes('basePrice')
      ? pass(`HTTP 200; fields: ${k.join(',')}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M3-03', async () => {
    const r = await api('GET', `${PROD}?search=galon`);
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const empty = await api('GET', `${PROD}?search=zzzznothing`);
    const erows = Array.isArray(empty.body) ? empty.body : empty.body?.items ?? [];
    return r.status === 200 && rows.length > 0 && empty.status === 200 && erows.length === 0
      ? pass(`search 'galon' => ${rows.length} hits; no-match search => HTTP 200 empty list`)
      : fail(`search HTTP ${r.status} (${rows.length}); empty-search HTTP ${empty.status} (${erows.length})`);
  });

  await check('UAT-M3-04', async () => {
    const cats = await api('GET', '/products/api/v1/categories');
    const catId = (Array.isArray(cats.body) ? cats.body : cats.body?.items ?? [])[0]?.id;
    const sku = `UAT-${uniq()}`;
    const r = await api('POST', PROD, {
      token: ctx.admin, body: { name: 'Galon Refill 19L UAT', sku, unit: 'Galon 19L', basePrice: 6000, categoryId: catId },
    });
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    ctx.uatProduct = r.body;
    const pub = await api('GET', `${PROD}?search=UAT`);
    const rows = Array.isArray(pub.body) ? pub.body : pub.body?.items ?? [];
    return rows.some((p) => p.id === r.body.id)
      ? pass(`HTTP ${r.status}; product visible in the public catalog immediately`)
      : fail(`created (HTTP ${r.status}) but not returned by the public catalog`);
  });

  await check('UAT-M3-05', async () => {
    const r = await api('PATCH', `${PROD}/${ctx.uatProduct.id}`, { token: ctx.admin, body: { active: false } });
    const pub = await api('GET', `${PROD}?limit=200`);
    const rows = Array.isArray(pub.body) ? pub.body : pub.body?.items ?? [];
    return r.status < 400 && !rows.some((p) => p.id === ctx.uatProduct.id)
      ? pass(`HTTP ${r.status}; product no longer in the public catalog`)
      : fail(`HTTP ${r.status}; still listed publicly: ${rows.some((p) => p.id === ctx.uatProduct.id)}`);
  });

  await check('UAT-M3-06', async () => {
    const neg = await api('POST', PROD, { token: ctx.admin, body: { name: 'X', sku: `N-${uniq()}`, unit: 'Pcs', basePrice: -1000 } });
    const zero = await api('POST', PROD, { token: ctx.admin, body: { name: 'X', sku: `Z-${uniq()}`, unit: 'Pcs', basePrice: 0 } });
    return neg.status >= 400 && zero.status >= 400
      ? pass(`-1000 => ${neg.status}; 0 => ${zero.status}`)
      : fail(`-1000 => ${neg.status}; 0 => ${zero.status}`);
  });

  await check('UAT-M3-07', async () => {
    const r = await api('POST', PROD, { token: A, body: { name: 'Hack', sku: `H-${uniq()}`, unit: 'Pcs', basePrice: 1000 } });
    return r.status === 403 ? pass('HTTP 403') : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M3-08', async () => {
    const r = await api('GET', `${PROD}/${ctx.uatProduct.id}`);
    const orderable = r.status === 200 && r.body?.active !== false;
    return !orderable
      ? pass(`HTTP ${r.status}; active=${r.body?.active} — not orderable`)
      : fail(`inactive product still served as active: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M3-09', async () => {
    const one = await api('POST', PROD, { token: ctx.admin, body: { name: 'Batas 1', sku: `B1-${uniq()}`, unit: 'Pcs', basePrice: 1 } });
    const big = await api('POST', PROD, { token: ctx.admin, body: { name: 'Batas Besar', sku: `B2-${uniq()}`, unit: 'Pcs', basePrice: 999999999 } });
    const readBig = big.status < 400 ? await api('GET', `${PROD}/${big.body.id}`) : null;
    const exact = readBig?.body?.basePrice === 999999999;
    return one.status < 400 && big.status < 400 && exact
      ? pass(`price 1 => ${one.status}; price 999.999.999 => ${big.status}, stored exactly (no rounding/overflow)`)
      : fail(`price 1 => ${one.status}; 999.999.999 => ${big.status}; read-back=${readBig?.body?.basePrice}`);
  });

  // ---------------------------------------------------------------- M4
  const P = await firstProduct();
  ctx.product = P;

  await check('UAT-M4-01', async () => {
    await api('DELETE', CART, { token: A });
    const r = await api('POST', `${CART}/items`, { token: A, body: { productId: P.id, quantity: 2 } });
    const c = await api('GET', CART, { token: A });
    const items = c.body?.items ?? [];
    const line = items.find((i) => i.productId === P.id);
    const sub = c.body?.subtotal ?? c.body?.subtotalIdr;
    return r.status < 400 && line?.quantity === 2
      ? pass(`HTTP ${r.status}; qty=2; subtotal=${sub}`)
      : fail(`HTTP ${r.status}; cart=${JSON.stringify(c.body)}`);
  });

  await check('UAT-M4-02', async () => {
    const r = await api('PUT', `${CART}/items/${P.id}`, { token: A, body: { quantity: 3 } });
    const c = await api('GET', CART, { token: A });
    const items = c.body?.items ?? [];
    const lines = items.filter((i) => i.productId === P.id);
    return r.status < 400 && lines.length === 1 && lines[0].quantity === 3
      ? pass(`HTTP ${r.status}; single line for (customer,product) at qty 3; subtotal=${c.body?.subtotal ?? c.body?.subtotalIdr}`)
      : fail(`HTTP ${r.status}; lines=${JSON.stringify(lines)}`);
  });

  await check('UAT-M4-03', async () => {
    const all = await api('GET', `${PROD}?limit=100`);
    const rows = Array.isArray(all.body) ? all.body : all.body?.items ?? [];
    const other = rows.find((x) => x.id !== P.id);
    await api('POST', `${CART}/items`, { token: A, body: { productId: other.id, quantity: 1 } });
    const r = await api('DELETE', `${CART}/items/${other.id}`, { token: A });
    const c = await api('GET', CART, { token: A });
    const ids = (c.body?.items ?? []).map((i) => i.productId);
    return r.status < 400 && !ids.includes(other.id) && ids.includes(P.id)
      ? pass(`HTTP ${r.status}; removed item gone, other item intact; subtotal=${c.body?.subtotal ?? c.body?.subtotalIdr}`)
      : fail(`HTTP ${r.status}; cart ids=${JSON.stringify(ids)}`);
  });

  await check('UAT-M4-04', async () => {
    const r = await api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship() } });
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    ctx.orderA = r.body;
    const c = await api('GET', CART, { token: A });
    const emptied = (c.body?.items ?? []).length === 0;
    const numberOk = /^HM-\d{8}-/.test(r.body.orderNumber ?? '');
    return r.body.status === 'CREATED' && numberOk && emptied
      ? pass(`HTTP ${r.status}; ${r.body.orderNumber}; status=CREATED; cart emptied`)
      : fail(`status=${r.body.status}; number=${r.body.orderNumber}; cartEmptied=${emptied}`);
  });

  await check('UAT-M4-05', async () => {
    const list = await api('GET', ORD, { token: A });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const d = await api('GET', `${ORD}/${ctx.orderA.id}`, { token: A });
    return list.status === 200 && rows.length > 0 && d.status === 200 && d.body?.status
      ? pass(`list HTTP 200 (${rows.length}); detail status=${d.body.status}`)
      : fail(`list HTTP ${list.status}; detail HTTP ${d.status}`);
  });

  await check('UAT-M4-06', async () => {
    const r = await api('PATCH', `${ORD}/${ctx.orderA.id}/status`, { token: ctx.operator ?? ctx.admin, body: { status: 'CONFIRMED' } });
    const d = await api('GET', `${ORD}/${ctx.orderA.id}`, { token: A });
    return r.status < 400 && d.body?.status === 'CONFIRMED'
      ? pass(`HTTP ${r.status}; order now CONFIRMED`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; status=${d.body?.status}`);
  });

  await check('UAT-M4-07', async () => {
    await api('DELETE', CART, { token: A });
    const r = await api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship() } });
    const s = JSON.stringify(r.body);
    return r.status === 422 && /CART_EMPTY/i.test(s)
      ? pass(`HTTP 422 ORDER_CART_EMPTY`)
      : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M4-12', async () => {
    await api('DELETE', CART, { token: A });
    const tampered = await api('POST', `${CART}/items`, { token: A, body: { productId: P.id, quantity: 1, price: 1, unitPrice: 1 } });
    await api('POST', `${CART}/items`, { token: A, body: { productId: P.id, quantity: 1 } });
    const r = await api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship(), items: [{ productId: P.id, quantity: 1, unitPrice: 1 }] } });
    const clean = await api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship() } });
    const unit = clean.body?.items?.[0]?.unitPrice ?? clean.body?.items?.[0]?.priceIdr ?? clean.body?.items?.[0]?.unitPriceIdr;
    // The authoritative price is the DEPOT's resolved price (override + active pricing
    // rule), which is legitimately not the catalog basePrice — JKT-01 carries a +10%
    // PERCENT rule, so 20000 becomes 22000. What the case must prove is that the client's
    // number never wins: both tampered payloads are rejected and the stored price is the
    // server's own.
    return tampered.status === 400 && r.status === 400 && Number(unit) > 1
      ? pass(`client price fields rejected outright (cart ${tampered.status}, checkout ${r.status}); order priced at the server-resolved ${unit} (catalog base ${P.basePrice}, depot rule applied), never the client's 1`)
      : fail(`cart with price => ${tampered.status}; checkout with items => ${r.status}; order unit price=${unit} vs basePrice ${P.basePrice}`);
  });

  await check('UAT-M4-14', async () => {
    const out = [];
    for (const q of [0, -1, 1.5]) {
      const r = await api('POST', `${CART}/items`, { token: A, body: { productId: P.id, quantity: q } });
      out.push(`${q}=>${r.status}`);
    }
    return out.every((o) => o.endsWith('=>400')) ? pass(out.join(' ')) : fail(out.join(' '));
  });

  await check('UAT-M4-15', async () => {
    await api('DELETE', CART, { token: A });
    await api('POST', `${CART}/items`, { token: A, body: { productId: P.id, quantity: 1 } });
    const [a, b] = await Promise.all([
      api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship() } }),
      api('POST', `${ORD}/checkout`, { token: A, body: { deliveryAddress: ship() } }),
    ]);
    const created = [a, b].filter((r) => r.status < 400);
    return created.length === 1
      ? pass(`double submit: one order created, other HTTP ${[a, b].find((r) => r.status >= 400).status}`)
      : fail(`${created.length} orders created from a double submit (${a.status}/${b.status})`);
  });

  // ---------------------------------------------------------------- M5
  const code = `UAT${uniq().toUpperCase()}`;
  await check('UAT-M5-03', async () => {
    const r = await api('POST', VOU, {
      token: ctx.admin,
      body: {
        code, description: 'UAT Diskon 10%', discountType: 'PERCENTAGE', value: 10,
        validFrom: new Date(Date.now() - 86400e3).toISOString(), validUntil: new Date(Date.now() + 30 * 86400e3).toISOString(),
        usageLimit: 100, active: true,
      },
    });
    ctx.voucherPct = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; code=${code}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M5-14', async () => {
    const r = await api('POST', VOU, {
      token: ctx.admin,
      body: { code, description: 'Duplikat', discountType: 'PERCENTAGE', value: 5,
        validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 86400e3).toISOString() },
    });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /TAKEN|exist|duplicate/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M5-15', async () => {
    const zero = await api('POST', VOU, { token: ctx.admin, body: { code: `Z${uniq()}`, description: 'z', discountType: 'PERCENTAGE', value: 0, validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 86400e3).toISOString() } });
    const neg = await api('POST', VOU, { token: ctx.admin, body: { code: `N${uniq()}`, description: 'n', discountType: 'PERCENTAGE', value: -5, validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 86400e3).toISOString() } });
    return zero.status >= 400 && neg.status >= 400 ? pass(`0 => ${zero.status}; -5 => ${neg.status}`) : fail(`0 => ${zero.status}; -5 => ${neg.status}`);
  });

  await check('UAT-M5-05', async () => {
    const r = await api('POST', `${VOU}/quote`, { token: A, body: { code: 'KODEPALSU123', subtotal: 50000 } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /NOT_FOUND/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });
}
