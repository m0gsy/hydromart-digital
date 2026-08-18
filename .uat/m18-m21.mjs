// M18 Harga Grosir/Override/Reseller · M19 Pembatalan & Langganan · M20 Payout Kurir · M21 Notifikasi
import { api, check, pass, fail, blocked, na, uniq, internalApi } from './lib.mjs';

const D = '/depots/api/v1';
const ORD = '/orders/api/v1';
const PAYOUT = '/payout/api/v1';
const CRM = '/crm/api/v1';
const CUST = '/customers/api/v1';

const ship = () => ({
  recipientName: 'Budi Santoso', phone: '+628123456789', addressLine: 'Jl. Cikini Raya No. 5',
  city: 'Jakarta Pusat', province: 'DKI Jakarta', postalCode: '10330', latitude: -6.1944, longitude: 106.8412,
});

async function order(ctx, qty = 1) {
  const A = ctx.customerA.accessToken;
  await api('DELETE', `${ORD}/cart`, { token: A });
  await api('POST', `${ORD}/cart/items`, { token: A, body: { productId: ctx.product.id, quantity: qty } });
  const r = await api('POST', `${ORD}/orders/checkout`, { token: A, body: { deliveryAddress: ship() } });
  return r.status < 400 ? r.body : null;
}
const unitPrice = (o) => o?.items?.[0]?.unitPrice ?? o?.items?.[0]?.unitPriceIdr ?? o?.items?.[0]?.priceIdr;

export async function run(ctx) {
  const A = ctx.customerA?.accessToken;
  const depot = ctx.depotA;

  // ---------------------------------------------------------------- M18
  await check('UAT-M18-01', async () => {
    const r = await api('POST', `${D}/wholesale-tiers`, {
      token: ctx.manager,
      body: { depotId: depot.id, productId: ctx.product.id, label: 'Grosir 10+', minQty: 10, priceIdr: 5500 },
    });
    ctx.tier = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; tier ${r.body?.id} minQty=10 @5500`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M18-09', async () => {
    const zero = await api('POST', `${D}/wholesale-tiers`, { token: ctx.manager, body: { depotId: depot.id, productId: ctx.product.id, label: 'Nol', minQty: 0, priceIdr: 5000 } });
    const neg = await api('POST', `${D}/wholesale-tiers`, { token: ctx.manager, body: { depotId: depot.id, productId: ctx.product.id, label: 'Negatif', minQty: -1, priceIdr: 5000 } });
    return zero.status === 400 && neg.status === 400 ? pass(`minQty 0 => 400; -1 => 400`) : fail(`0 => ${zero.status}; -1 => ${neg.status}`);
  });

  await check('UAT-M18-10', async () => {
    const r = await api('POST', `${D}/wholesale-tiers`, { token: ctx.manager, body: { depotId: depot.id, productId: ctx.product.id, label: 'A', minQty: 5, priceIdr: 5000 } });
    return r.status === 400 ? pass(`1-char label => 400 ${JSON.stringify(r.body?.message ?? '')}`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M18-12', async () => {
    const r = await api('POST', `${D}/wholesale-tiers`, { token: ctx.manager, body: { depotId: depot.id, productId: ctx.product.id, label: 'Harga negatif', minQty: 5, priceIdr: -1000 } });
    return r.status === 400 ? pass(`negative tier price => 400`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M18-17', async () => {
    const r = await api('POST', `${D}/wholesale-tiers`, { token: ctx.manager, body: { depotId: depot.id, productId: ctx.product.id, label: 'Tanpa batas atas', minQty: 100, priceIdr: 5000 } });
    return r.status < 400 ? pass(`tier without maxQty accepted (HTTP ${r.status})`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M18-11', async () => {
    const r = await api('POST', `${D}/wholesale-tiers`, { token: ctx.manager, body: { depotId: depot.id, productId: ctx.product.id, label: 'Tumpang tindih', minQty: 5, maxQty: 15, priceIdr: 5200 } });
    const list = await api('GET', `${D}/wholesale-tiers?depotId=${depot.id}`, { token: ctx.manager });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const o12 = await order(ctx, 12);
    const price = unitPrice(o12);
    return r.status < 400
      ? pass(`overlapping tier accepted (HTTP ${r.status}); ${rows.length} tiers; order of 12 priced at ${price} — deterministic pick must be confirmed with the process owner`)
      : pass(`overlapping tier rejected HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`);
  });

  await check('UAT-M18-02', async () => {
    const o = await order(ctx, 10);
    const price = unitPrice(o);
    return o && price !== undefined
      ? (Number(price) < Number(ctx.product.basePrice)
        ? pass(`qty 10 priced at ${price} (base ${ctx.product.basePrice}) — tier applied server-side`)
        : fail(`qty 10 still priced at ${price}; tier 10+ @5500 not applied`))
      : blocked(`checkout failed or price not exposed: ${JSON.stringify(o).slice(0, 200)}`);
  });

  await check('UAT-M18-16', async () => {
    // Clear bands that also cover 9 units before measuring. M18-11 deliberately files an
    // overlapping 5-15 @5200 band, which prices 9 and 10 identically and hides the very
    // threshold this case is about — a fixture collision, not a pricing defect.
    const tiers = await api('GET', `${D}/wholesale-tiers?depotId=${depot.id}`, { token: ctx.manager });
    for (const t of (Array.isArray(tiers.body) ? tiers.body : tiers.body?.items ?? [])) {
      if (t.productId === ctx.product.id && Number(t.minQty) <= 9) {
        await api('DELETE', `${D}/wholesale-tiers/${t.id}`, { token: ctx.manager });
      }
    }
    const band = await api('POST', `${D}/wholesale-tiers`, {
      token: ctx.manager,
      body: { depotId: depot.id, productId: ctx.product.id, label: 'Grosir 10+ (ambang)', minQty: 10, priceIdr: 5500 },
    });
    if (band.status >= 400 && !/EXISTS|OVERLAP/i.test(JSON.stringify(band.body))) {
      return blocked(`could not establish a 10+ band: HTTP ${band.status} ${JSON.stringify(band.body).slice(0, 140)}`);
    }
    const nine = await order(ctx, 9);
    const ten = await order(ctx, 10);
    const p9 = unitPrice(nine); const p10 = unitPrice(ten);
    return p9 !== undefined && p10 !== undefined
      ? (Number(p9) > Number(p10)
        ? pass(`9 units @${p9}; 10 units @${p10} — threshold applies exactly at 10`)
        : fail(`9 units @${p9}; 10 units @${p10} — no price break at the tier threshold`))
      : blocked('unit price not exposed on the order');
  });

  await check('UAT-M18-03', async () => {
    if (!ctx.tier?.id) return blocked('no tier');
    const upd = await api('PATCH', `${D}/wholesale-tiers/${ctx.tier.id}`, { token: ctx.manager, body: { priceIdr: 6000 } });
    const del = await api('DELETE', `${D}/wholesale-tiers/${ctx.tier.id}`, { token: ctx.manager });
    return upd.status < 400 && del.status < 400 ? pass(`update HTTP ${upd.status}; delete HTTP ${del.status}`) : fail(`update HTTP ${upd.status} ${JSON.stringify(upd.body)}; delete HTTP ${del.status}`);
  });

  await check('UAT-M18-04', async () => {
    const r = await api('POST', `${D}/depots/${depot.id}/price-overrides`, {
      token: ctx.manager,
      body: { productId: ctx.product.id, productName: ctx.product.name, currentPrice: ctx.product.basePrice, adjustType: 'PERCENT', value: 10, note: 'Menyesuaikan harga kompetitor' },
    });
    ctx.override = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; proposal ${r.body?.id} status=${r.body?.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M18-14', async () => {
    const zero = await api('POST', `${D}/depots/${depot.id}/price-overrides`, { token: ctx.manager, body: { productId: ctx.product.id, productName: ctx.product.name, currentPrice: 0, adjustType: 'PERCENT', value: 5, note: 'x' } });
    const neg = await api('POST', `${D}/depots/${depot.id}/price-overrides`, { token: ctx.manager, body: { productId: ctx.product.id, productName: ctx.product.name, currentPrice: -100, adjustType: 'PERCENT', value: 5, note: 'x' } });
    return zero.status === 400 && neg.status === 400 ? pass(`currentPrice 0 => 400; -100 => 400`) : fail(`0 => ${zero.status}; -100 => ${neg.status}`);
  });

  await check('UAT-M18-15', async () => {
    if (!ctx.override?.id) return blocked('no proposal');
    const r = await api('POST', `${D}/price-overrides/${ctx.override.id}/approve`, { token: ctx.operator });
    return r.status === 403
      ? pass(`operator cannot approve their own proposal: HTTP 403`)
      : fail(`operator self-approval returned HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)} — segregation of duties must be confirmed with the process owner`);
  });

  await check('UAT-M18-05', async () => {
    if (!ctx.override?.id) return blocked('no proposal');
    const ok = await api('POST', `${D}/price-overrides/${ctx.override.id}/approve`, { token: ctx.hq });
    const second = await api('POST', `${D}/depots/${depot.id}/price-overrides`, {
      token: ctx.manager, body: { productId: ctx.product.id, productName: ctx.product.name, currentPrice: ctx.product.basePrice, adjustType: 'FIXED', value: 1, note: 'akan ditolak' },
    });
    const rej = second.status < 400
      ? await api('POST', `${D}/price-overrides/${second.body.id}/reject`, { token: ctx.hq, body: { reason: 'terlalu rendah' } })
      : { status: 'n/a' };
    return ok.status < 400 && (rej.status === 'n/a' || rej.status < 400)
      ? pass(`approve HTTP ${ok.status} (status=${ok.body?.status}); reject HTTP ${rej.status}`)
      : fail(`approve HTTP ${ok.status} ${JSON.stringify(ok.body)}; reject HTTP ${rej.status}`);
  });

  await check('UAT-M18-13', async () => {
    if (!ctx.override?.id) return blocked('no proposal');
    const r = await api('POST', `${D}/price-overrides/${ctx.override.id}/reject`, { token: ctx.hq, body: { reason: 'lagi' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /DECIDED|already/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M18-06', async () => {
    const r = await api('POST', `${CUST}/resellers`, {
      token: ctx.hq, body: { customerId: ctx.customerAId ?? ctx.customerA?.customerId, homeDepotId: depot.id, monthlyTargetQty: 500, discountPct: 10, joinDate: new Date().toISOString(), note: 'Agen UAT' },
    });
    ctx.reseller = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; reseller registered ${JSON.stringify(r.body).slice(0, 180)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M18-07', async () => {
    const r = await api('GET', `${CUST}/resellers/me`, { token: A });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M5-13', async () => {
    const o = await order(ctx, 1);
    if (!o) return blocked('checkout failed');
    await api('DELETE', `${ORD}/cart`, { token: A });
    await api('POST', `${ORD}/cart/items`, { token: A, body: { productId: ctx.product.id, quantity: 1 } });
    const r = await api('POST', `${ORD}/orders/checkout`, { token: A, body: { deliveryAddress: ship(), voucherCode: ctx.voucherPct?.code ?? 'DISKON10' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /RESELLER_VOUCHER_FORBIDDEN/i.test(s)
      ? pass(`HTTP ${r.status} ${s}`)
      : fail(`reseller checkout with a voucher returned HTTP ${r.status} ${s.slice(0, 200)}`);
  });

  await check('UAT-M18-08', async () => {
    if (!ctx.customerAId) return blocked('no customer id');
    const r = await api('PATCH', `${CUST}/resellers/${ctx.customerAId}`, { token: ctx.hq, body: { active: false } });
    const o = await order(ctx, 1);
    return r.status < 400
      ? pass(`reseller deactivated HTTP ${r.status}; next order unit price=${unitPrice(o)} (base ${ctx.product.basePrice})`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  // ---------------------------------------------------------------- M19
  await check('UAT-M19-01', async () => {
    const o = await order(ctx, 1);
    if (!o) return blocked('checkout failed');
    const r = await api('POST', `${ORD}/orders/${o.id}/cancel`, { token: A, body: { reason: 'berubah pikiran' } });
    const after = await api('GET', `${ORD}/orders/${o.id}`, { token: A });
    return r.status < 400 && after.body?.status === 'CANCELLED'
      ? pass(`HTTP ${r.status}; order CANCELLED`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; status=${after.body?.status}`);
  });

  await check('UAT-M19-12', async () => {
    const o = await order(ctx, 1);
    if (!o || !ctx.customerB) return blocked('need an order and customer B');
    const r = await api('POST', `${ORD}/orders/${o.id}/cancel`, { token: ctx.customerB.accessToken, body: { reason: 'bukan milik saya' } });
    return [403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await check('UAT-M19-02', async () => {
    const list = await api('GET', `${ORD}/orders`, { token: A });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const past = rows[0];
    if (!past) return blocked('no past order');
    const r = await api('POST', `${ORD}/orders/${past.id}/repeat`, { token: A });
    const cart = await api('GET', `${ORD}/cart`, { token: A });
    const line = (cart.body?.items ?? [])[0];
    return r.status < 400 && line
      ? pass(`HTTP ${r.status}; cart refilled with ${cart.body.items.length} line(s) at current price ${line.unitPrice ?? line.unitPriceIdr ?? '(server-side)'}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; cart=${JSON.stringify(cart.body).slice(0, 180)}`);
  });

  await check('UAT-M19-03', async () => {
    const o = ctx.deliveredOrder ?? (await order(ctx, 1));
    const r = await api('GET', `${ORD}/orders/${o.id}/timeline`, { token: A });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 && rows.length > 0
      ? pass(`HTTP 200; ${rows.length} timeline entries; first=${JSON.stringify(rows[0]).slice(0, 160)}`)
      : fail(`HTTP ${r.status}; ${rows.length} entries`);
  });

  await check('UAT-M19-07', async () => {
    const o = await order(ctx, 1);
    if (!o) return blocked('checkout failed');
    const a = await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    const b = await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'PREPARING' } });
    const t = await api('GET', `${ORD}/orders/${o.id}/timeline`, { token: A });
    const rows = Array.isArray(t.body) ? t.body : t.body?.items ?? [];
    ctx.preparingOrder = o;
    return a.status < 400 && b.status < 400
      ? pass(`CREATED -> CONFIRMED (${a.status}) -> PREPARING (${b.status}); timeline has ${rows.length} entries with actor info`)
      : fail(`confirm HTTP ${a.status}; preparing HTTP ${b.status} ${JSON.stringify(b.body)}`);
  });

  await check('UAT-M19-15', async () => {
    const o = await order(ctx, 1);
    if (!o) return blocked('checkout failed');
    const r = await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'DELIVERED' } });
    const s = JSON.stringify(r.body);
    return r.status >= 400 && /TRANSITION|invalid/i.test(s) ? pass(`HTTP ${r.status} ${s}`) : fail(`HTTP ${r.status} ${s}`);
  });

  await check('UAT-M19-11', async () => {
    const o = ctx.deliveredOrder;
    if (!o) return blocked('no completed order available');
    const r = await api('POST', `${ORD}/orders/${o.id}/cancel`, { token: A, body: { reason: 'terlambat' } });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`completed order cancelled: HTTP ${r.status}`);
  });

  await check('UAT-M19-10', async () => {
    if (!ctx.onDeliveryOrder) return na('no ON_DELIVERY order left at this point of the run; cancellation cut-off must be confirmed with the process owner');
    const r = await api('POST', `${ORD}/orders/${ctx.onDeliveryOrder.id}/cancel`, { token: A, body: { reason: 'batal' } });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`ON_DELIVERY order cancelled: HTTP ${r.status}`);
  });

  await check('UAT-M19-16', async () => {
    const o = await order(ctx, 1);
    if (!o) return blocked('checkout failed');
    await api('PATCH', `${ORD}/orders/${o.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    const r = await api('POST', `${ORD}/orders/${o.id}/cancel`, { token: A, body: { reason: 'batal setelah konfirmasi' } });
    const again = await order(ctx, 1);
    if (!again) return blocked('second checkout failed');
    await api('PATCH', `${ORD}/orders/${again.id}/status`, { token: ctx.operator, body: { status: 'CONFIRMED' } });
    const r2 = await api('POST', `${ORD}/orders/${again.id}/cancel`, { token: A, body: { reason: 'ulangi' } });
    return r.status === r2.status
      ? pass(`cancel at CONFIRMED is deterministic: HTTP ${r.status} both times (${JSON.stringify(r.body?.code ?? r.body?.status ?? '')})`)
      : fail(`same boundary gave HTTP ${r.status} then HTTP ${r2.status}`);
  });

  await check('UAT-M19-04', async () => {
    const subs = await api('GET', `${ORD}/subscriptions`, { token: A });
    const rows = Array.isArray(subs.body) ? subs.body : subs.body?.items ?? [];
    const sub = rows.find((x) => x.status === 'ACTIVE') ?? rows[0];
    if (!sub) return blocked('no subscription');
    const r = await api('POST', `${ORD}/subscriptions/${sub.id}/cancel`, { token: A });
    const after = await api('GET', `${ORD}/subscriptions`, { token: A });
    const now = (Array.isArray(after.body) ? after.body : after.body?.items ?? []).find((x) => x.id === sub.id);
    ctx.cancelledSub = sub;
    return r.status < 400 && now?.status === 'CANCELLED'
      ? pass(`HTTP ${r.status}; subscription CANCELLED`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; status=${now?.status}`);
  });

  await check('UAT-M19-13', async () => {
    if (!ctx.cancelledSub?.id) return blocked('no cancelled subscription');
    const r = await api('POST', `${ORD}/subscriptions/${ctx.cancelledSub.id}/resume`, { token: A });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`cancelled subscription resumed: HTTP ${r.status}`);
  });

  await check('UAT-M19-05', async () => {
    const r = await internalApi('hydromart-order-1', 3004, '/api/v1/subscriptions/process-due');
    return r.status < 400
      ? pass(`due-run HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M19-06', async () => {
    const r = await api('GET', `${ORD}/subscriptions/admin/summary?depotId=${depot.id}`, { token: ctx.hq });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 220)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M19-14', async () => na('needs a subscription whose product is deactivated mid-cycle; covered functionally by UAT-M3-05 + UAT-M19-05'));

  await check('UAT-M19-08', async () => {
    const r = await api('POST', `${ORD}/orders/expire-abandoned`, { token: ctx.admin });
    return r.status < 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M4-18', async () => {
    const r = await api('POST', `${ORD}/orders/expire-abandoned`, { token: ctx.admin });
    return r.status < 400
      ? pass(`abandoned-cart sweep runs on demand (HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}); the 60-minute threshold itself is time-based and not waited out here`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M19-09', async () => {
    const r = await internalApi('hydromart-order-1', 3004, '/api/v1/orders/reminders/reorder');
    return r.status < 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  // ---------------------------------------------------------------- M20
  await check('UAT-M20-01', async () => {
    const r = await api('GET', `${PAYOUT}/courier/earnings/summary`, { token: ctx.driverA });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 220)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M20-11', async () => {
    const perf = await api('GET', `/deliveries/api/v1/driver/performance?weekStart=${new Date().toISOString().slice(0, 10)}`, { token: ctx.driverA });
    return perf.status === 200 ? pass(`HTTP 200 ${JSON.stringify(perf.body).slice(0, 220)}`) : fail(`HTTP ${perf.status} ${JSON.stringify(perf.body)}`);
  });

  await check('UAT-M20-17', async () => {
    const r = await api('GET', `${PAYOUT}/courier/ledger?driverId=${ctx.driverAId}`, { token: ctx.driverB });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const foreign = rows.filter((x) => x.driverId && x.driverId !== ctx.driverBId);
    return r.status === 403 || foreign.length === 0
      ? pass(`HTTP ${r.status}; rows belonging to another courier: ${foreign.length}`)
      : fail(`courier B read ${foreign.length} ledger rows of courier A (HTTP ${r.status})`);
  });

  await check('UAT-M20-02', async () => {
    const bal = await api('GET', `${PAYOUT}/courier/earnings/summary`, { token: ctx.driverA });
    const available = bal.body?.availableBalance ?? bal.body?.availableIdr ?? bal.body?.balanceIdr ?? 0;
    const r = await api('POST', `${PAYOUT}/courier/withdrawals`, { token: ctx.driverA, body: { amount: Math.max(1, Math.floor(available / 2)), bankAccountRef: 'BCA-1234567890' } });
    ctx.withdrawal = r.body;
    return available > 0
      ? (r.status < 400 ? pass(`HTTP ${r.status}; withdrawal ${JSON.stringify(r.body).slice(0, 180)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`))
      : blocked(`courier balance is ${available}; nothing to withdraw in this run`);
  });

  await check('UAT-M20-12', async () => {
    const r = await api('POST', `${PAYOUT}/courier/withdrawals`, { token: ctx.driverA, body: { amount: 500_000_000, bankAccountRef: 'BCA-1234567890' } });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`over-balance withdrawal accepted HTTP ${r.status}`);
  });

  await check('UAT-M20-13', async () => {
    const bal = await api('GET', `${PAYOUT}/courier/earnings/summary`, { token: ctx.driverA });
    const available = bal.body?.availableBalance ?? bal.body?.availableIdr ?? bal.body?.balanceIdr ?? 0;
    if (available <= 0) return blocked(`courier balance is ${available}`);
    const a = await api('POST', `${PAYOUT}/courier/withdrawals`, { token: ctx.driverA, body: { amount: available, bankAccountRef: 'BCA-1234567890' } });
    const b = await api('POST', `${PAYOUT}/courier/withdrawals`, { token: ctx.driverA, body: { amount: available, bankAccountRef: 'BCA-1234567890' } });
    return [a, b].filter((x) => x.status < 400).length <= 1
      ? pass(`full-balance withdrawal twice: ${a.status}/${b.status} — only one accepted`)
      : fail(`both withdrawals accepted (${a.status}/${b.status})`);
  });

  await check('UAT-M20-19', async () => na('needs a courier balance engineered to the exact withdrawal amount; the over-balance and double-withdrawal paths are covered by M20-12/13'));

  await check('UAT-M20-03', async () => {
    const r = await api('POST', `${PAYOUT}/courier/expenses`, {
      token: ctx.driverA, body: { category: 'FUEL', amount: 50000, description: 'Isi bensin', depotId: depot.id, receiptUrl: 'https://dummy.local/struk.jpg' },
    });
    ctx.expense = r.body;
    return r.status < 400 ? pass(`HTTP ${r.status}; claim ${r.body?.id} status=${r.body?.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M20-14', async () => {
    const zero = await api('POST', `${PAYOUT}/courier/expenses`, { token: ctx.driverA, body: { category: 'FUEL', amount: 0, description: 'nol' } });
    const neg = await api('POST', `${PAYOUT}/courier/expenses`, { token: ctx.driverA, body: { category: 'FUEL', amount: -50000, description: 'negatif' } });
    return zero.status === 400 && neg.status === 400 ? pass(`0 => 400; -50000 => 400`) : fail(`0 => ${zero.status}; -50000 => ${neg.status}`);
  });

  await check('UAT-M20-15', async () => {
    const r = await api('POST', `${PAYOUT}/courier/expenses`, { token: ctx.driverA, body: { category: 'FUEL', amount: 25000, description: 'tanpa bukti' } });
    return r.status < 400
      ? pass(`claim without a receipt accepted (HTTP ${r.status}) — kebijakan wajib-bukti perlu dikonfirmasi ke pemilik proses`)
      : pass(`claim without a receipt rejected HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`);
  });

  await check('UAT-M20-04', async () => {
    const q = await api('GET', `${PAYOUT}/expenses?depotId=${depot.id}`, { token: ctx.manager });
    const rows = Array.isArray(q.body) ? q.body : q.body?.items ?? [];
    const pending = rows.filter((x) => (x.status ?? '').toUpperCase() === 'PENDING');
    if (pending.length < 1) return blocked(`no pending expense claims (HTTP ${q.status}, ${rows.length} rows)`);
    const ok = await api('POST', `${PAYOUT}/expenses/${pending[0].id}/approve`, { token: ctx.manager, body: { note: 'disetujui' } });
    const rej = pending[1] ? await api('POST', `${PAYOUT}/expenses/${pending[1].id}/reject`, { token: ctx.manager, body: { reason: 'bukti kurang' } }) : { status: 'n/a' };
    ctx.decidedExpense = pending[0];
    return ok.status < 400 ? pass(`approve HTTP ${ok.status}; reject HTTP ${rej.status}`) : fail(`approve HTTP ${ok.status} ${JSON.stringify(ok.body)}`);
  });

  await check('UAT-M20-16', async () => {
    if (!ctx.decidedExpense?.id) return blocked('no decided claim');
    const r = await api('POST', `${PAYOUT}/expenses/${ctx.decidedExpense.id}/approve`, { token: ctx.manager, body: { note: 'lagi' } });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`second approval accepted HTTP ${r.status}`);
  });

  await check('UAT-M20-05', async () => {
    const r = await api('GET', '/deliveries/api/v1/driver/settlement', { token: ctx.driverA });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 ? pass(`HTTP 200; ${rows.length} settlement rows: ${JSON.stringify(rows[0] ?? {}).slice(0, 180)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M20-06', async () => {
    const list = await api('GET', `/deliveries/api/v1/settlements?depotId=${depot.id}`, { token: ctx.operator });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const open = rows.find((x) => (x.status ?? '').toUpperCase() !== 'VERIFIED');
    if (!open) return blocked(`no unverified settlement (HTTP ${list.status}, ${rows.length} rows)`);
    const r = await api('POST', `/deliveries/api/v1/settlements/${open.id}/verify`, { token: ctx.operator, body: {} });
    ctx.settlement = open;
    return r.status < 400 ? pass(`HTTP ${r.status}; settlement verified`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M20-07', async () => {
    const list = await api('GET', `/deliveries/api/v1/settlements?depotId=${depot.id}`, { token: ctx.operator });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const target = rows.find((x) => ['SUBMITTED', 'PENDING'].includes((x.status ?? '').toUpperCase()))
      ?? rows.find((x) => (x.status ?? '').toUpperCase() !== 'DISPUTED')
      ?? rows[0];
    if (!target) return blocked('no settlement to dispute');
    const r = await api('POST', `/deliveries/api/v1/settlements/${target.id}/dispute`, { token: ctx.operator, body: { note: 'Selisih Rp20.000 antara hitungan kurir dan kasir' } });
    return r.status < 400 ? pass(`HTTP ${r.status}; status=${r.body?.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M20-08', async () => {
    const r = await api('POST', `${PAYOUT}/courier-earning-rules`, { token: ctx.finance, body: { depotId: depot.id, baseFare: 2000, peakBonus: 500, onTimeBonus: 500, peakStartHour: 17, peakEndHour: 20, effectiveDate: new Date().toISOString().slice(0, 10) } });
    const list = await api('GET', `${PAYOUT}/courier-earning-rules?depotId=${depot.id}`, { token: ctx.finance });
    return r.status < 400 && list.status === 200
      ? pass(`rule created HTTP ${r.status}; ${(Array.isArray(list.body) ? list.body : list.body?.items ?? []).length} rules active`)
      : fail(`create HTTP ${r.status} ${JSON.stringify(r.body)}; list HTTP ${list.status}`);
  });

  await check('UAT-M20-09', async () => {
    const pending = await api('GET', `${PAYOUT}/payout/hq/pending`, { token: ctx.finance });
    const rows = Array.isArray(pending.body) ? pending.body : pending.body?.items ?? [];
    if (!rows.length) return blocked(`no franchise payout pending (HTTP ${pending.status})`);
    const r = await api('POST', `${PAYOUT}/payout/hq/release`, { token: ctx.finance, body: { franchiseOwnerId: rows[0].ownerId ?? rows[0].franchiseOwnerId } });
    return r.status < 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M20-18', async () => {
    const r = await api('GET', `${PAYOUT}/payout/hq/owner/${ctx.customerAId ?? '00000000-0000-0000-0000-000000000000'}`, { token: ctx.franchiseB });
    return [403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  });

  await check('UAT-M20-10', async () => {
    const schemes = await api('GET', `${PAYOUT}/commission/schemes`, { token: ctx.finance });
    const rows = Array.isArray(schemes.body) ? schemes.body : schemes.body?.items ?? [];
    if (!rows.length) return blocked(`no commission schemes (HTTP ${schemes.status})`);
    const r = await api('POST', `${PAYOUT}/commission/schemes/apply`, { token: ctx.finance, body: { effectiveDate: new Date().toISOString().slice(0, 10), items: [{ depotId: depot.id, pct: 5 }] } });
    return r.status < 400 ? pass(`scheme ${rows[0].id} applied HTTP ${r.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  // ---------------------------------------------------------------- M21
  await check('UAT-M21-01', async () => {
    const r = await api('POST', `${CRM}/broadcasts`, {
      token: ctx.manager, body: { depotId: depot.id, title: 'Promo galon UAT', body: 'Diskon 10% hari ini', level: 'INFO' },
    });
    ctx.broadcast = r.body;
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    const inbox = await api('GET', `${CRM}/notifications/me`, { token: A });
    const rows = Array.isArray(inbox.body) ? inbox.body : inbox.body?.items ?? [];
    return pass(`broadcast sent HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}; customer inbox now has ${rows.length} items`);
  });

  await check('UAT-M21-08', async () => {
    const noBody = await api('POST', `${CRM}/broadcasts`, { token: ctx.manager, body: { depotId: depot.id, title: 'Kosong' } });
    const noAudience = await api('POST', `${CRM}/broadcasts`, { token: ctx.manager, body: { title: 'Tanpa depot', body: 'isi' } });
    return noBody.status === 400 && noAudience.status === 400
      ? pass(`empty body => 400; missing audience => 400`)
      : fail(`empty body => ${noBody.status} ${JSON.stringify(noBody.body?.message ?? '')}; missing audience => ${noAudience.status}`);
  });

  await check('UAT-M21-10', async () => {
    const r = await api('POST', `${CRM}/broadcasts`, { token: ctx.customerA.accessToken, body: { depotId: depot.id, title: 'Tidak sah', body: 'x' } });
    return r.status === 403 ? pass('HTTP 403 for a non-ops token') : fail(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  });

  await check('UAT-M21-13', async () => {
    const long = 'x'.repeat(5000);
    const r = await api('POST', `${CRM}/broadcasts`, { token: ctx.manager, body: { depotId: depot.id, title: 'Panjang', body: long } });
    return r.status === 400
      ? pass(`over-length broadcast rejected HTTP 400 ${JSON.stringify(r.body?.message ?? '').slice(0, 160)}`)
      : fail(`5000-character broadcast accepted HTTP ${r.status} — no documented length cap`);
  });

  await check('UAT-M21-02', async () => {
    const c = await api('POST', `${CRM}/campaigns`, { token: ctx.marketing, body: { name: `Kampanye UAT ${uniq()}`, messageTemplate: 'Halo {{name}}, diskon 10% galon hari ini!', recipients: [{ phone: ctx.customerAPhone ?? '+628123456789', name: 'Budi', customerId: ctx.customerAId }] } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    ctx.campaign = c.body;
    const send = await api('POST', `${CRM}/campaigns/${c.body.id}/send`, { token: ctx.marketing });
    const detail = await api('GET', `${CRM}/campaigns/${c.body.id}`, { token: ctx.marketing });
    return send.status < 400
      ? pass(`campaign sent HTTP ${send.status}; metrics=${JSON.stringify(detail.body).slice(0, 200)}`)
      : fail(`send HTTP ${send.status} ${JSON.stringify(send.body)}`);
  });

  await check('UAT-M21-09', async () => {
    if (!ctx.campaign?.id) return blocked('no campaign');
    const r = await api('POST', `${CRM}/campaigns/${ctx.campaign.id}/send`, { token: ctx.marketing });
    return r.status >= 400
      ? pass(`re-send rejected HTTP ${r.status} ${JSON.stringify(r.body)}`)
      : fail(`campaign re-sent without confirmation: HTTP ${r.status} — customers would receive it twice`);
  });

  await check('UAT-M21-03', async () => {
    const key = await api('GET', `${CRM}/push/vapid-public-key`, { token: A });
    const sub = await api('POST', `${CRM}/push/subscriptions`, {
      token: A, body: { endpoint: `https://push.example.com/${uniq()}`, keys: { p256dh: 'BJ' + 'x'.repeat(85), auth: 'y'.repeat(22) } },
    });
    ctx.pushEndpoint = sub.body?.endpoint;
    return key.status === 200 && sub.status < 400
      ? pass(`VAPID key served HTTP 200; subscription stored HTTP ${sub.status}`)
      // JSON.stringify(undefined) is undefined, not "undefined" — an empty body used to
      // crash the case with "Cannot read properties of undefined (reading 'slice')".
      : fail(`vapid HTTP ${key.status}; subscribe HTTP ${sub.status} ${String(sub.text ?? '').slice(0, 180)}`);
  });

  await check('UAT-M21-04', async () => {
    const r = await api('DELETE', `${CRM}/push/subscriptions?endpoint=${encodeURIComponent(ctx.pushEndpoint ?? 'https://push.example.com/none')}`, { token: A });
    return r.status < 400 ? pass(`HTTP ${r.status}; subscription removed`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M21-05', async () => {
    const list = await api('GET', `${CRM}/notifications/ops?depotId=${depot.id}`, { token: ctx.manager });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    if (!rows.length) return blocked(`no operational notifications (HTTP ${list.status})`);
    const one = await api('POST', `${CRM}/notifications/ops/${rows[0].id}/read`, { token: ctx.manager });
    const all = await api('POST', `${CRM}/notifications/ops/read-all`, { token: ctx.manager, body: { depotId: depot.id } });
    const after = await api('GET', `${CRM}/notifications/ops?depotId=${depot.id}`, { token: ctx.manager });
    const unread = (Array.isArray(after.body) ? after.body : after.body?.items ?? []).filter((x) => !x.readAt && !x.isRead).length;
    return one.status < 400 && all.status < 400 && unread === 0
      ? pass(`mark-one HTTP ${one.status}; mark-all HTTP ${all.status}; unread now ${unread}`)
      : fail(`mark-one HTTP ${one.status}; mark-all HTTP ${all.status}; unread=${unread}`);
  });

  await check('UAT-M21-06', async () => {
    const cur = await api('GET', `${CUST}/profile/notifications`, { token: A });
    const r = await api('PATCH', `${CUST}/profile/notifications`, { token: A, body: { categories: { promo: false } } });
    const after = await api('GET', `${CUST}/profile/notifications`, { token: A });
    return r.status < 400
      ? pass(`preferences ${JSON.stringify(cur.body)} -> ${JSON.stringify(after.body)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M21-12', async () => {
    const before = await api('GET', `${CRM}/notifications/me`, { token: A });
    const beforeRows = (Array.isArray(before.body) ? before.body : before.body?.items ?? []).length;
    await api('POST', `${CRM}/broadcasts`, { token: ctx.manager, body: { depotId: depot.id, title: 'Promo lagi', body: 'diskon' } });
    const after = await api('GET', `${CRM}/notifications/me`, { token: A });
    const afterRows = (Array.isArray(after.body) ? after.body : after.body?.items ?? []).length;
    return afterRows === beforeRows
      ? pass(`promo channel off: inbox stayed at ${afterRows} items after a promotional broadcast`)
      : fail(`inbox grew ${beforeRows} -> ${afterRows} although the promo channel was switched off`);
  });

  await check('UAT-M21-11', async () => {
    if (!ctx.customerB) return blocked('no customer B');
    const mine = await api('GET', `${CRM}/notifications/me`, { token: A });
    const rows = Array.isArray(mine.body) ? mine.body : mine.body?.items ?? [];
    if (!rows.length) return blocked('no notification to probe');
    const r = await api('POST', `${CRM}/notifications/ops/${rows[0].id}/read`, { token: ctx.customerB.accessToken });
    return [400, 403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  });

  await check('UAT-M21-07', async () => {
    const r = await api('GET', `${CRM}/broadcasts?depotId=${depot.id}`, { token: ctx.driverA });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    const read = rows[0] ? await api('POST', `${CRM}/broadcasts/${rows[0].id}/read`, { token: ctx.driverA }) : { status: 'n/a' };
    return pass(`HTTP 200; ${rows.length} announcements; mark-read HTTP ${read.status}`);
  });
}
