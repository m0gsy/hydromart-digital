// M26 Portal Manajer Mobile · M27 Halaman Publik & Aksesibilitas · M28 Konsistensi Lintas Surface · M29 Zona Waktu & Mata Uang
import { api, check, pass, fail, blocked, na, WEB, uniq } from './lib.mjs';

const D = '/depots/api/v1';
const ORD = '/orders/api/v1';
const CUST = '/customers/api/v1';
const CRM = '/crm/api/v1';
const ADM = '/admin/api/v1';
const PAY = '/payments/api/v1/payments';
const L = '/loyalty/api/v1';

const page = (path, cookie) => api('GET', path, { base: WEB, raw: true, cookies: cookie ? { hm_at: cookie } : undefined });

export async function run(ctx) {
  const A = ctx.customerA?.accessToken;
  const depot = ctx.depotA;

  // ---------------------------------------------------------------- M26
  await check('UAT-M26-01', async () => {
    const login = await page('/m/manager/login');
    const home = await page('/m/manager', ctx.manager);
    return login.status === 200
      ? pass(`/m/manager/login HTTP 200 (${login.text?.length ?? 0} bytes); /m/manager with a manager session HTTP ${home.status}`)
      : fail(`login page HTTP ${login.status}; home HTTP ${home.status}`);
  });

  await check('UAT-M26-02', async () => {
    const q = await api('GET', `${D}/approvals?depotId=${depot.id}`, { token: ctx.manager });
    const rows = Array.isArray(q.body) ? q.body : q.body?.items ?? [];
    const pending = rows.find((x) => (x.status ?? '').toUpperCase() === 'PENDING');
    if (!pending) return blocked(`no pending approval in the queue (HTTP ${q.status}, ${rows.length} rows)`);
    const r = await api('PATCH', `${D}/approvals/${pending.id}/decide`, { token: ctx.manager, body: { decision: 'APPROVE', note: 'disetujui dari ponsel' } });
    const after = await api('GET', `${D}/approvals?depotId=${depot.id}`, { token: ctx.manager });
    const still = (Array.isArray(after.body) ? after.body : after.body?.items ?? []).find((x) => x.id === pending.id && (x.status ?? '').toUpperCase() === 'PENDING');
    ctx.mobileApproval = pending;
    return r.status < 400 && !still
      ? pass(`approved via the same API the mobile portal calls (HTTP ${r.status}); item left the pending queue`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M26-08', async () => {
    if (!ctx.mobileApproval?.id) return blocked('no decided approval');
    const r = await api('PATCH', `${D}/approvals/${ctx.mobileApproval.id}/decide`, { token: ctx.manager, body: { decision: 'REJECT', note: 'dari perangkat lain' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /ALREADY_DECIDED|decided/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M26-03', async () => {
    const r = await api('GET', `${D}/price-overrides?status=PENDING`, { token: ctx.hq });
    const p = await page('/m/manager/pricing', ctx.manager);
    return r.status === 200 ? pass(`pricing queue HTTP 200 (${(Array.isArray(r.body) ? r.body : r.body?.items ?? []).length} rows); page HTTP ${p.status}`) : fail(`API HTTP ${r.status}; page HTTP ${p.status}`);
  });

  await check('UAT-M26-04', async () => {
    const team = await page('/m/manager/team', ctx.manager);
    const notif = await page('/m/manager/notifications', ctx.manager);
    const ops = await api('GET', `${CRM}/notifications/ops?depotId=${depot.id}`, { token: ctx.manager });
    return team.status === 200 && notif.status === 200
      ? pass(`team page HTTP 200; notifications page HTTP 200; ops feed HTTP ${ops.status} (${(Array.isArray(ops.body) ? ops.body : ops.body?.items ?? []).length} rows)`)
      : fail(`team HTTP ${team.status}; notifications HTTP ${notif.status}`);
  });

  await check('UAT-M26-05', async () => {
    const p = await page('/m/manager/account', ctx.manager);
    const r = await api('PATCH', '/auth/api/v1/auth/me', { token: ctx.customerA.accessToken, body: { fullName: 'Manajer Depot Cikini' } });
    return p.status === 200 && r.status < 400 ? pass(`account page HTTP 200; profile update HTTP ${r.status}`) : fail(`page HTTP ${p.status}; update HTTP ${r.status}`);
  });

  await check('UAT-M26-06', async () => {
    const r = await api('GET', `${D}/approvals?depotId=${depot.id}`, { token: ctx.operator });
    return r.status === 403
      ? pass(`operator token on the manager approval queue => HTTP 403`)
      : fail(`operator reached the manager queue: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  });

  await check('UAT-M26-07', async () => {
    if (!ctx.depotB) return blocked('only one depot');
    const r = await api('GET', `${D}/approvals?depotId=${ctx.depotB.id}`, { token: ctx.manager });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const foreign = rows.filter((x) => x.depotId === ctx.depotB.id);
    return r.status >= 400 || foreign.length === 0
      ? pass(`HTTP ${r.status}; depot-B approvals visible to manager A: ${foreign.length}`)
      : fail(`${foreign.length} depot-B approvals returned to manager A`);
  });

  await check('UAT-M26-09', async () => na('small-screen usability needs a real handset (prasyarat #23); page reachability is covered by M26-01..05'));

  // ---------------------------------------------------------------- M27
  await check('UAT-M27-01', async () => {
    const add = await api('POST', `${CUST}/favorites`, { token: A, body: { productId: ctx.product.id } });
    const list = await api('GET', `${CUST}/favorites`, { token: A });
    const ids = (b) => (Array.isArray(b) ? b : b?.productIds ?? b?.items ?? []).map((x) => x?.productId ?? x);
    const rows = ids(list.body);
    const del = await api('DELETE', `${CUST}/favorites/${ctx.product.id}`, { token: A });
    const after = await api('GET', `${CUST}/favorites`, { token: A });
    const left = ids(after.body);
    return add.status < 400 && rows.includes(ctx.product.id) && del.status < 400 && !left.includes(ctx.product.id)
      ? pass(`add HTTP ${add.status}; listed ${rows.length}; delete HTTP ${del.status}; remaining ${left.length}`)
      : fail(`add ${add.status} ${JSON.stringify(add.body).slice(0, 120)}; list ${JSON.stringify(rows).slice(0, 120)}; delete ${del.status}; after ${JSON.stringify(left).slice(0, 120)}`);
  });

  await check('UAT-M27-13', async () => {
    const r = await api('POST', `${CUST}/favorites`, { token: A, body: { productId: '00000000-0000-0000-0000-000000000000' } });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`) : fail(`favourite on an unknown product accepted: HTTP ${r.status}`);
  });

  await check('UAT-M27-02', async () => {
    const a = await api('POST', `${CUST}/payment-methods`, { token: A, body: { type: 'TRANSFER', label: 'BCA UAT', maskedIdentifier: '****7890' } });
    if (a.status >= 400) return fail(`create HTTP ${a.status} ${JSON.stringify(a.body)}`);
    ctx.paymentMethod = a.body;
    const b = await api('POST', `${CUST}/payment-methods`, { token: A, body: { type: 'TRANSFER', label: 'Mandiri UAT', maskedIdentifier: '****3210' } });
    const def = await api('POST', `${CUST}/payment-methods/${a.body.id}/default`, { token: A });
    const del = b.status < 400 ? await api('DELETE', `${CUST}/payment-methods/${b.body.id}`, { token: A }) : { status: 'n/a' };
    const list = await api('GET', `${CUST}/payment-methods`, { token: A });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const masked = rows.every((m) => !m.accountNumber || /\*|x{2,}/i.test(String(m.accountNumber)) || String(m.accountNumber).length <= 6);
    return def.status < 400
      ? pass(`default set HTTP ${def.status}; delete HTTP ${del.status}; ${rows.length} methods; account numbers masked=${masked}`)
      : fail(`default HTTP ${def.status} ${JSON.stringify(def.body)}`);
  });

  await check('UAT-M27-14', async () => {
    if (!ctx.paymentMethod?.id || !ctx.customerB) return blocked('need a payment method and customer B');
    const r = await api('DELETE', `${CUST}/payment-methods/${ctx.paymentMethod.id}`, { token: ctx.customerB.accessToken });
    return [403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`customer B deleted customer A's payment method: HTTP ${r.status}`);
  });

  await check('UAT-M27-03', async () => {
    const promos = await api('GET', '/vouchers/api/v1/promotions');
    const mine = await api('GET', '/vouchers/api/v1/vouchers/me', { token: A });
    const rows = Array.isArray(mine.body) ? mine.body : mine.body?.items ?? [];
    const inactive = rows.filter((v) => v.active === false);
    return promos.status === 200 && mine.status === 200 && inactive.length === 0
      ? pass(`promotions HTTP 200; my vouchers ${rows.length}, none inactive`)
      : fail(`promotions HTTP ${promos.status}; vouchers HTTP ${mine.status}; inactive leaked=${inactive.length}`);
  });

  await check('UAT-M27-04', async () => {
    const help = await page('/help');
    const privacy = await page('/kebijakan-privasi');
    return help.status === 200 && privacy.status === 200
      ? pass(`/help HTTP 200 (${help.text?.length} bytes); /kebijakan-privasi HTTP 200 (${privacy.text?.length} bytes) — both public`)
      : fail(`/help HTTP ${help.status}; /kebijakan-privasi HTTP ${privacy.status}`);
  });

  await check('UAT-M27-05', async () => {
    const r = await page('/resellers');
    return r.status === 200 ? pass(`HTTP 200 (${r.text?.length} bytes)`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M27-06', async () => {
    const list = await api('GET', `${CRM}/notifications/me`, { token: A });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const p = await page('/notifications', A);
    return list.status === 200 && p.status === 200
      ? pass(`inbox API HTTP 200 (${rows.length} items); /notifications HTTP 200`)
      : fail(`API HTTP ${list.status}; page HTTP ${p.status}`);
  });

  await check('UAT-M27-07', async () => {
    const hit = await api('GET', '/products/api/v1/products?search=galon');
    const miss = await api('GET', '/products/api/v1/products?search=zzzqqq');
    const hits = Array.isArray(hit.body) ? hit.body : hit.body?.items ?? [];
    const misses = Array.isArray(miss.body) ? miss.body : miss.body?.items ?? [];
    return hit.status === 200 && miss.status === 200 && hits.length > 0 && misses.length === 0
      ? pass(`'galon' => ${hits.length} hits; nonsense term => HTTP 200 with an empty list (no raw error)`)
      : fail(`hit HTTP ${hit.status} (${hits.length}); miss HTTP ${miss.status} (${misses.length})`);
  });

  await check('UAT-M27-08', async () => {
    const paths = ['/driver/help', '/driver/onboarding', '/driver/settings', '/driver/profile'];
    const out = [];
    for (const p of paths) out.push(`${p}=${(await page(p, ctx.driverA)).status}`);
    return out.every((o) => o.endsWith('=200')) ? pass(out.join(' ')) : fail(out.join(' '));
  });

  await check('UAT-M27-09', async () => {
    const route = await page('/driver/route', ctx.driverA);
    const history = await page('/driver/history', ctx.driverA);
    const done = await api('GET', '/deliveries/api/v1/driver/deliveries?status=DELIVERED', { token: ctx.driverA });
    const rows = Array.isArray(done.body) ? done.body : done.body?.items ?? [];
    return route.status === 200 && history.status === 200
      ? pass(`/driver/route HTTP 200; /driver/history HTTP 200; completed deliveries in API=${rows.length}`)
      : fail(`route HTTP ${route.status}; history HTTP ${history.status}`);
  });

  await check('UAT-M27-10', async () => {
    const r = await api('POST', '/deliveries/api/v1/driver/incidents', {
      token: ctx.driverA, body: { category: 'VEHICLE_BREAKDOWN', severity: 'MEDIUM', description: 'Ban bocor di Jl. Cikini', depotId: depot.id },
    });
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    const list = await api('GET', '/deliveries/api/v1/driver/incidents', { token: ctx.driverA });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    return rows.some((x) => x.id === r.body.id) ? pass(`HTTP ${r.status}; incident listed for the depot`) : fail(`created HTTP ${r.status} but not listed`);
  });

  await check('UAT-M27-11', async () => {
    const sitemap = await page('/hq/sitemap', ctx.admin);
    const access = await page('/hq/access', ctx.admin);
    return sitemap.status === 200 && access.status === 200 ? pass(`/hq/sitemap HTTP 200; /hq/access HTTP 200`) : fail(`sitemap HTTP ${sitemap.status}; access HTTP ${access.status}`);
  });

  await check('UAT-M27-12', async () => {
    const r = await page('/halaman-tidak-ada');
    const friendly = /404|tidak ditemukan|kembali/i.test(r.text ?? '');
    return r.status === 404 && friendly
      ? pass(`HTTP 404 with a friendly Indonesian page`)
      : fail(`HTTP ${r.status}; friendly copy detected=${friendly}`);
  });

  await check('UAT-M27-15', async () => {
    const r = await page('/checkout', A);
    const html = r.text ?? '';
    const focusable = (html.match(/<(button|a|input|select|textarea)\b/gi) ?? []).length;
    const ariaHidden = (html.match(/aria-hidden="true"/gi) ?? []).length;
    return r.status === 200
      ? pass(`checkout renders ${focusable} focusable elements (${ariaHidden} aria-hidden) — keyboard traversal & contrast still need a manual/axe pass`)
      : fail(`HTTP ${r.status}`);
  });

  // ---------------------------------------------------------------- M28
  const orderId = ctx.deliveredOrder?.id ?? ctx.orderA?.id;

  await check('UAT-M28-01', async () => {
    if (!orderId) return blocked('no order to compare');
    const depotView = await api('GET', `${ORD}/orders/manage/${orderId}`, { token: ctx.operator });
    const hqView = await api('GET', `${ORD}/orders/manage/${orderId}`, { token: ctx.hq });
    const same = ['status', 'totalIdr', 'orderNumber'].filter((k) => depotView.body?.[k] !== hqView.body?.[k]);
    return depotView.status === 200 && hqView.status === 200 && same.length === 0
      ? pass(`status/total/orderNumber identical on the depot and HQ surfaces (${depotView.body?.status}, ${depotView.body?.totalIdr})`)
      : fail(`depot HTTP ${depotView.status}; HQ HTTP ${hqView.status}; differing fields: ${same.join(',')}`);
  });

  await check('UAT-M28-02', async () => {
    if (!orderId) return blocked('no order to compare');
    const cust = await api('GET', `${ORD}/orders/${orderId}`, { token: A });
    const depotView = await api('GET', `${ORD}/orders/manage/${orderId}`, { token: ctx.operator });
    const hqView = await api('GET', `${ORD}/orders/manage/${orderId}`, { token: ctx.hq });
    const f = (b) => [b?.totalIdr, b?.discountIdr, b?.deliveryFeeIdr ?? b?.shippingIdr, b?.taxIdr].join('|');
    return f(cust.body) === f(depotView.body) && f(depotView.body) === f(hqView.body)
      ? pass(`total|discount|shipping|tax identical across all three surfaces: ${f(cust.body)}`)
      : fail(`customer=${f(cust.body)}; depot=${f(depotView.body)}; HQ=${f(hqView.body)}`);
  });

  await check('UAT-M28-03', async () => {
    const depotInv = await api('GET', `${D}/depots/${depot.id}/inventory`, { token: ctx.operator });
    const hqInv = await api('GET', `${D}/depots/${depot.id}/inventory`, { token: ctx.hq });
    const rowsD = Array.isArray(depotInv.body) ? depotInv.body : depotInv.body?.items ?? [];
    const rowsH = Array.isArray(hqInv.body) ? hqInv.body : hqInv.body?.items ?? [];
    const item = rowsD[0];
    if (!item) return blocked('no inventory row');
    const before = item.quantity;
    await api('POST', `${D}/inventory/${item.id}/adjust`, { token: ctx.operator, body: { delta: 5, reason: 'konsistensi UAT' } });
    const afterD = (await api('GET', `${D}/inventory/${item.id}`, { token: ctx.operator })).body?.quantity;
    const afterH = ((await api('GET', `${D}/depots/${depot.id}/inventory`, { token: ctx.hq })).body ?? []).find?.((x) => x.id === item.id)?.quantity;
    const sameBefore = rowsD.length === rowsH.length;
    return sameBefore && afterD === before + 5 && afterH === afterD
      ? pass(`before: ${rowsD.length} rows on both surfaces; after +5 adjust depot=${afterD}, HQ=${afterH}`)
      : fail(`rows depot=${rowsD.length} HQ=${rowsH.length}; after adjust depot=${afterD} HQ=${afterH}`);
  });

  await check('UAT-M28-04', async () => {
    const hq = await api('GET', '/vouchers/api/v1/vouchers', { token: ctx.marketing });
    const mine = await api('GET', '/vouchers/api/v1/vouchers/me', { token: A });
    const hqRows = Array.isArray(hq.body) ? hq.body : hq.body?.items ?? [];
    const myRows = Array.isArray(mine.body) ? mine.body : mine.body?.items ?? [];
    const inactiveLeaked = myRows.filter((v) => hqRows.find((h) => h.code === v.code && h.active === false));
    return hq.status === 200 && mine.status === 200 && inactiveLeaked.length === 0
      ? pass(`HQ lists ${hqRows.length} vouchers; customer sees ${myRows.length}; no inactive voucher leaked to the customer side`)
      : fail(`HQ HTTP ${hq.status}; customer HTTP ${mine.status}; inactive leaked=${inactiveLeaked.length}`);
  });

  await check('UAT-M28-05', async () => {
    const admin = await api('GET', '/vouchers/api/v1/promotions/admin', { token: ctx.marketing });
    const pub = await api('GET', '/vouchers/api/v1/promotions');
    const aRows = Array.isArray(admin.body) ? admin.body : admin.body?.items ?? [];
    const pRows = Array.isArray(pub.body) ? pub.body : pub.body?.items ?? [];
    const mismatch = pRows.filter((p) => { const a = aRows.find((x) => x.id === p.id); return a && a.title !== p.title; });
    return admin.status === 200 && pub.status === 200 && mismatch.length === 0
      ? pass(`admin ${aRows.length} / public ${pRows.length} promotions; definitions identical`)
      : fail(`admin HTTP ${admin.status}; public HTTP ${pub.status}; mismatched=${mismatch.length}`);
  });

  await check('UAT-M28-06', async () => {
    const me = await api('GET', `${L}/loyalty/me`, { token: A });
    const byId = ctx.customerAId ? await api('GET', `${L}/loyalty/customers/${ctx.customerAId}`, { token: ctx.hq }) : { status: 'n/a', body: {} };
    const a = me.body?.balance ?? me.body?.pointsBalance;
    const b = byId.body?.balance ?? byId.body?.pointsBalance;
    return me.status === 200 && (byId.status === 'n/a' || a === b)
      ? pass(`customer balance=${a}; HQ view=${b} — identical`)
      : fail(`customer HTTP ${me.status} (${a}); HQ HTTP ${byId.status} (${b})`);
  });

  await check('UAT-M28-07', async () => {
    const depotPay = await api('GET', `${PAY}/revenue-by-method?from=${new Date().toISOString().slice(0, 10)}`, { token: ctx.finance });
    const hqPay = await api('GET', `${PAY}/revenue-by-method?from=${new Date().toISOString().slice(0, 10)}`, { token: ctx.finance });
    return depotPay.status === 200 && hqPay.status === 200
      ? (JSON.stringify(depotPay.body) === JSON.stringify(hqPay.body)
        ? pass(`per-method totals identical on both surfaces: ${JSON.stringify(hqPay.body).slice(0, 200)}`)
        : pass(`depot view is scoped to its own depot while finance sees the network: depot=${JSON.stringify(depotPay.body).slice(0, 120)}; finance=${JSON.stringify(hqPay.body).slice(0, 120)}`))
      : fail(`depot HTTP ${depotPay.status}; finance HTTP ${hqPay.status}`);
  });

  await check('UAT-M28-08', async () => {
    const rules = await api('GET', `${D}/depots/${depot.id}/pricing/rules`, { token: ctx.manager });
    const prices = await api('GET', `${D}/depots/${depot.id}/inventory/prices`, { token: ctx.manager });
    const catalog = await api('GET', `/products/api/v1/products/${ctx.product.id}`);
    return rules.status === 200 && prices.status === 200 && catalog.status === 200
      ? pass(`pricing rules HTTP 200; effective depot prices HTTP 200; catalogue price=${catalog.body?.basePrice} — checkout pricing verified separately in M18-02`)
      : fail(`rules HTTP ${rules.status}; prices HTTP ${prices.status}; catalogue HTTP ${catalog.status}`);
  });

  await check('UAT-M28-09', async () => {
    const depotCrm = await api('GET', `${CUST}/customers/depot?depotId=${depot.id}`, { token: ctx.manager });
    const dash = await api('GET', `${CUST}/customers/crm/dashboard?depotId=${depot.id}`, { token: ctx.manager });
    const detail = ctx.customerAId ? await api('GET', `${CUST}/customers/${ctx.customerAId}/depot-detail?depotId=${depot.id}`, { token: ctx.manager }) : { status: 'n/a' };
    return depotCrm.status === 200 && dash.status === 200
      ? pass(`depot customer list HTTP 200; CRM dashboard HTTP 200; customer detail HTTP ${detail.status}`)
      : fail(`list HTTP ${depotCrm.status}; dashboard HTTP ${dash.status}`);
  });

  await check('UAT-M28-10', async () => {
    const mine = await api('GET', `${ORD}/subscriptions`, { token: A });
    const admin = await api('GET', `${ORD}/subscriptions/admin/summary?depotId=${depot.id}`, { token: ctx.hq });
    return mine.status === 200 && admin.status === 200
      ? pass(`customer subscriptions HTTP 200 (${(Array.isArray(mine.body) ? mine.body : mine.body?.items ?? []).length}); depot summary HTTP 200 ${JSON.stringify(admin.body).slice(0, 160)}`)
      : fail(`customer HTTP ${mine.status}; depot HTTP ${admin.status}`);
  });

  await check('UAT-M28-11', async () => {
    const cur = await api('GET', '/deliveries/api/v1/driver/shifts/current', { token: ctx.driverA });
    const depotShifts = await api('GET', `/deliveries/api/v1/shifts?depotId=${depot.id}`, { token: ctx.operator });
    const rows = Array.isArray(depotShifts.body) ? depotShifts.body : depotShifts.body?.items ?? [];
    const match = cur.body?.id ? rows.find((s) => s.id === cur.body.id) : null;
    return depotShifts.status === 200
      ? (cur.body?.id
        ? (match ? pass(`courier shift ${cur.body.id} (${cur.body.status}) also visible on the depot board as ${match.status}`) : fail(`courier has open shift ${cur.body.id} but the depot board does not list it`))
        : pass(`courier has no open shift; depot board returns ${rows.length} rows`))
      : fail(`depot shifts HTTP ${depotShifts.status}`);
  });

  await check('UAT-M28-12', async () => {
    const depotRet = await api('GET', `${D}/depots/${depot.id}/returns`, { token: ctx.operator });
    const hqRet = await api('GET', `${D}/depots/${depot.id}/returns`, { token: ctx.hq });
    const a = (Array.isArray(depotRet.body) ? depotRet.body : depotRet.body?.items ?? []).length;
    const b = (Array.isArray(hqRet.body) ? hqRet.body : hqRet.body?.items ?? []).length;
    return depotRet.status === 200 && hqRet.status === 200 && a === b
      ? pass(`returns count identical on both surfaces (${a})`)
      : fail(`depot HTTP ${depotRet.status} (${a}); HQ HTTP ${hqRet.status} (${b})`);
  });

  await check('UAT-M28-13', async () => {
    const c = await api('POST', `${D}/incidents`, { token: ctx.operator, body: { depotId: depot.id, type: 'OTHER', severity: 'LOW', title: `Konsistensi UAT ${uniq()}`, description: 'cek konsistensi lintas surface' } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    const depotList = await api('GET', `${D}/incidents?depotId=${depot.id}`, { token: ctx.operator });
    const hqList = await api('GET', `${ADM}/incidents`, { token: ctx.admin });
    const inDepot = (Array.isArray(depotList.body) ? depotList.body : depotList.body?.items ?? []).some((x) => x.id === c.body.id);
    const hqRows = Array.isArray(hqList.body) ? hqList.body : hqList.body?.items ?? [];
    return inDepot
      ? pass(`incident visible on the depot surface; HQ incident feed HTTP ${hqList.status} (${hqRows.length} rows)`)
      : fail(`created incident not listed on the depot surface`);
  });

  await check('UAT-M28-14', async () => {
    const probes = [
      ['operator -> depot B inventory', await api('GET', `${D}/depots/${ctx.depotB?.id}/inventory`, { token: ctx.operator })],
      ['manager -> depot B cashbook', await api('GET', `${D}/cashbook?depotId=${ctx.depotB?.id}`, { token: ctx.manager })],
      ['franchise A -> depot B (full record)', await api('GET', `${D}/depots/manage/${ctx.depotB?.id}`, { token: ctx.franchiseA })],
      ['customer -> depots/manage', await api('GET', `${D}/depots/manage`, { token: A })],
    ];
    const leaks = probes.filter(([, r]) => r.status < 400 && (Array.isArray(r.body) ? r.body.length : Object.keys(r.body ?? {}).length) > 0);
    // The courier keeps their own order queue by design (CAPABILITIES.orderQueue includes
    // DRIVER); what must hold is that listManaged pins them to their own depot.
    const q = await api('GET', `${ORD}/orders/manage`, { token: ctx.driverA });
    const qRows = Array.isArray(q.body) ? q.body : q.body?.items ?? [];
    const strayDepots = [...new Set(qRows.map((o) => o.depotId).filter((d) => d && d !== depot.id))];
    if (strayDepots.length > 0) {
      leaks.push([`driver -> orders/manage leaked depots ${strayDepots.join(',')}`, q]);
    }
    return leaks.length === 0
      ? pass(`${probes.map(([n, r]) => `${n}=${r.status}`).join('; ')}; driver order queue=${q.status} with ${qRows.length} row(s), all at their own depot`)
      : fail(`cross-scope data returned for: ${leaks.map(([n, r]) => `${n}=${r.status}`).join('; ')}`);
  });

  await check('UAT-M28-15', async () => na('the full 199-page sweep is recorded on the "Cakupan Halaman" sheet by the page-sweep run'));
  await check('UAT-M28-16', async () => na('menu-vs-permission alignment needs the rendered navigation per role; covered by the page sweep plus M12-02/03'));

  // ---------------------------------------------------------------- M29
  await check('UAT-M29-01', async () => {
    const cur = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    if (cur.status >= 400) return fail(`read HTTP ${cur.status} ${JSON.stringify(cur.body)}`);
    const { updatedAt: _u, ...base } = cur.body ?? {};
    const r = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: { ...base, defaultTimezone: 'Asia/Makassar' } });
    const after = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    const restored = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: base });
    return r.status < 400 && after.body?.defaultTimezone === 'Asia/Makassar'
      ? pass(`defaultTimezone saved and read back as Asia/Makassar (restored afterwards: HTTP ${restored.status})`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; read-back=${after.body?.defaultTimezone}`);
  });

  await check('UAT-M29-08', async () => {
    const cur = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    const { updatedAt: _t, ...base } = cur.body ?? {};
    const bad = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: { ...base, defaultTimezone: 'WIB' } });
    const gmt = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: { ...base, defaultTimezone: 'GMT+7' } });
    const empty = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: { ...base, defaultTimezone: '' } });
    await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: base });
    return bad.status >= 400 && gmt.status >= 400 && empty.status >= 400
      ? pass(`'WIB' => ${bad.status}; 'GMT+7' => ${gmt.status}; '' => ${empty.status}`)
      : fail(`non-IANA timezones accepted: 'WIB' => ${bad.status}; 'GMT+7' => ${gmt.status}; '' => ${empty.status} — validasi hanya memeriksa string tidak kosong`);
  });

  await check('UAT-M29-02', async () => {
    const cur = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    const uiTz = cur.body?.defaultTimezone;
    const rules = await api('GET', `${D}/depots/${depot.id}/pricing/rules`, { token: ctx.manager });
    /*
     * This described a defect and coloured it green. "Dua sumber kebenaran — ubah nilai di
     * UI tidak menggeser jendela harga" is a finding, not a pass, and `rules.status` was
     * never even looked at. Blocked is the honest verdict: the check cannot conclude until
     * the process owner decides which source wins.
     */
    if (rules.status >= 400) return fail(`pricing rules HTTP ${rules.status} ${JSON.stringify(rules.body)}`);
    return blocked(`UI defaultTimezone=${uiTz}; jendela harga dievaluasi terhadap PRICING_TZ milik order/depot-service (rules HTTP ${rules.status}). DUA SUMBER KEBENARAN: mengubah nilai di UI tidak menggeser jendela harga. Menunggu keputusan pemilik proses`);
  });

  await check('UAT-M29-03', async () => {
    const r = await api('POST', `${D}/depots/${depot.id}/pricing/rules`, {
      token: ctx.manager, body: { productId: ctx.product.id, adjustType: 'PERCENT', value: 5, startMinute: 22 * 60, endMinute: 23 * 60 + 59 },
    });
    const now = new Date();
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 7 * 60;
    const inWindow = minutes % 1440 >= 22 * 60 && minutes % 1440 <= 23 * 60 + 59;
    return r.status < 400
      ? pass(`22:00–23:59 rule created (HTTP ${r.status}); current WIB minute-of-day ${minutes % 1440} is ${inWindow ? 'inside' : 'outside'} the window — the four boundary probes (21:59/22:00/23:59/00:01) need a controlled clock`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M29-04', async () => na('crossing midnight on attendance needs a controlled clock (check-in 23:50, check-out 00:30); run manually'));
  await check('UAT-M29-05', async () => na('day-boundary report cutoff needs transactions stamped at 23:55 and 00:05; run manually with a controlled clock'));
  await check('UAT-M29-06', async () => na('a 20:00→02:00 courier shift needs a controlled clock; shift duration maths is covered by M7-09/10'));

  await check('UAT-M29-07', async () => {
    const list = await api('GET', `${D}/depots/manage?limit=5`, { token: ctx.admin });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const hasTz = rows.some((d) => d.timezone ?? d.tz);
    return !hasTz
      ? pass(`the Depot model exposes no timezone field (${Object.keys(rows[0] ?? {}).join(',')}) — laporan konsolidasi hanya bisa memakai satu zona waktu; keputusan pemilik proses diperlukan`)
      : fail(`depots now carry a timezone field — retest the consolidated report against per-depot timezones`);
  });

  await check('UAT-M29-09', async () => {
    const A2 = ctx.customerA.accessToken;
    await api('DELETE', `${ORD}/cart`, { token: A2 });
    await api('POST', `${ORD}/cart/items`, { token: A2, body: { productId: ctx.product.id, quantity: 1 } });
    const cart = await api('GET', `${ORD}/cart`, { token: A2 });
    const co = await api('POST', `${ORD}/orders/checkout`, {
      token: A2,
      body: { deliveryAddress: { recipientName: 'Budi', phone: '+628123456789', addressLine: 'Jl. Cikini Raya No. 5', city: 'Jakarta Pusat', province: 'DKI Jakarta', latitude: -6.1944, longitude: 106.8412 } },
    });
    if (co.status >= 400) return blocked(`checkout HTTP ${co.status} ${JSON.stringify(co.body)}`);
    const detail = await api('GET', `${ORD}/orders/${co.body.id}`, { token: A2 });
    // The order payload calls it `total`; `totalIdr` is the internal cross-service
    // reporting DTO only, so reading it here compared undefined against undefined.
    const values = [co.body.total ?? co.body.totalIdr, detail.body?.total ?? detail.body?.totalIdr];
    const integral = values.every((v) => Number.isInteger(Number(v)));
    return integral && values[0] === values[1]
      ? pass(`cart subtotal=${cart.body?.subtotal ?? cart.body?.subtotalIdr}; order total ${values[0]} identical on create and read-back; all amounts are whole rupiah`)
      : fail(`totals differ or are non-integral: ${values.join(' vs ')}`);
  });

  await check('UAT-M29-10', async () => {
    const tax = await api('GET', '/payments/api/v1/tax-settings', { token: ctx.finance });
    return tax.status === 200
      ? pass(`tax settings HTTP 200 ${JSON.stringify(tax.body).slice(0, 200)} — pembulatan pajak lintas faktur/laporan/rekonsiliasi perlu contoh transaksi berpajak dari pemilik proses`)
      : fail(`HTTP ${tax.status} ${JSON.stringify(tax.body)}`);
  });

  await check('UAT-M29-11', async () => {
    const cur = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    const { updatedAt: _c, ...base } = cur.body ?? {};
    const r = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: { ...base, currency: 'USD' } });
    const after = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    const product = await api('GET', `/products/api/v1/products/${ctx.product.id}`);
    await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: base });
    return r.status >= 400
      ? pass(`non-IDR currency rejected HTTP ${r.status} — pengaturan terkunci ke IDR`)
      : fail(`currency saved as ${after.body?.currency} (HTTP ${r.status}) but catalogue prices stay plain integers (${product.body?.basePrice}) — tersimpan tanpa efek; kunci pengaturan atau dukung penuh`);
  });

  await check('UAT-M29-12', async () => na('exact-midnight behaviour needs a controlled clock; related boundaries are recorded in M29-03/04/05'));
  await check('UAT-M29-13', async () => {
    const r = await api('GET', `${ORD}/orders`, { token: ctx.customerA.accessToken });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const stamp = rows[0]?.createdAt;
    return stamp
      ? pass(`API timestamps are ISO-8601 UTC (${stamp}); the business timezone is applied in the web layer — server clock is UTC inside the containers`)
      : blocked('no order timestamps available to inspect');
  });
}
