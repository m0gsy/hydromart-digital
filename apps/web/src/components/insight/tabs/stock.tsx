'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { InventoryItem, InventoryWastageSummary, PurchaseOrder } from '@/lib/types';

const dash = '—';
const TOP = 8;

/** Stok & Pengadaan: what is running low, what has been ordered, and what was lost. */
export function StockTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotId, depotNames } = ctx;
  const mayStock = can('inventoryRead', role);
  const mayBuy = can('procurement', role);

  const low = useInsightData(
    () => api.get<InventoryItem[]>(endpoints.inventory.lowStock(depotId ?? undefined), true),
    [depotId],
    mayStock,
  );
  const orders = useInsightData(
    () =>
      api.get<PurchaseOrder[]>(
        endpoints.procurement.purchaseOrders.list({ depotId: depotId as string }),
        true,
      ),
    [depotId],
    mayBuy && depotId != null,
  );
  const wastage = useInsightData(
    () =>
      api.get<InventoryWastageSummary>(
        endpoints.inventory.wastage(depotId as string, { from: range.from, to: range.to }),
        true,
      ),
    [depotId, range.from, range.to],
    mayStock && depotId != null,
  );

  // A hidden line is one the depot has switched off: it is not "running low", it is not sold.
  const lowItems = (low.data ?? [])
    .filter((i) => !i.hidden)
    .sort((a, b) => a.available - a.minimumStock - (b.available - b.minimumStock));
  // A received order is history; what is open is a draft not yet sent or sent and not yet in.
  const open = (orders.data ?? []).filter((o) => o.status !== 'RECEIVED');
  const openValue = open.reduce((n, o) => n + o.totalIdr, 0);

  return (
    <div className="flex flex-col gap-6">
      {(mayBuy || mayStock) && depotId == null && (
        <p className="text-xs text-muted">{t('insight.stock.needDepot')}</p>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {mayStock && !low.forbidden && (
          <KpiCard
            label={t('insight.stock.lowCount')}
            value={low.data ? String(lowItems.length) : dash}
            definition={t('insight.stock.lowCountDef')}
            tone={lowItems.length > 0 ? 'danger' : undefined}
            goodWhen="down"
          />
        )}
        {mayBuy && depotId != null && !orders.forbidden && (
          <KpiCard
            label={t('insight.stock.openOrders')}
            value={orders.data ? String(open.length) : dash}
            hint={orders.data ? formatIDR(openValue) : undefined}
            definition={t('insight.stock.openOrdersDef')}
          />
        )}
        {mayStock && depotId != null && !wastage.forbidden && (
          <KpiCard
            label={t('insight.stock.loss')}
            value={
              wastage.data && wastage.data.totalLossIdr != null
                ? formatIDR(wastage.data.totalLossIdr)
                : dash
            }
            definition={t('insight.stock.lossDef')}
            goodWhen="down"
          />
        )}
      </section>

      {mayStock && (
        <WidgetCard
          title={t('insight.stock.lowTitle')}
          source={low}
          isEmpty={() => lowItems.length === 0}
          emptyText={t('insight.stock.lowEmpty')}
          detailHref="/dashboard/inventory"
        >
          {() => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {lowItems.slice(0, TOP).map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{i.label}</span>
                    {depotNames[i.depotId] && (
                      <span className="ml-2 text-xs text-muted">{depotNames[i.depotId]}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-[color:var(--danger)]">
                    {t('insight.ops.stockLine', { qty: i.available, min: i.minimumStock })}
                  </span>
                </li>
              ))}
              {lowItems.length > TOP && (
                <li className="text-xs text-muted">
                  {t('insight.ops.stockMore', { count: lowItems.length - TOP })}
                </li>
              )}
            </ul>
          )}
        </WidgetCard>
      )}

      {mayBuy && depotId != null && (
        <WidgetCard
          title={t('insight.stock.ordersTitle')}
          source={orders}
          isEmpty={() => open.length === 0}
          emptyText={t('insight.stock.ordersEmpty')}
          detailHref="/dashboard/purchase-orders"
        >
          {() => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead>
                  <tr>
                    {['po', 'supplier', 'status', 'total', 'expected'].map((c, i) => (
                      <th
                        key={c}
                        scope="col"
                        className={`p-2 font-medium text-muted ${i < 3 ? 'text-left' : 'text-right'}`}
                      >
                        {t(`insight.stock.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {open.slice(0, TOP).map((o) => (
                    <tr key={o.id}>
                      <th scope="row" className="p-2 text-left font-semibold">
                        {o.poNumber}
                      </th>
                      <td className="p-2 text-left">{o.supplierName}</td>
                      <td className="p-2 text-left">{t(`insight.stock.poStatus.${o.status}`)}</td>
                      <td className="p-2 text-right tabular-nums">{formatIDR(o.totalIdr)}</td>
                      <td className="p-2 text-right">
                        {o.expectedAt ? formatDate(o.expectedAt) : dash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WidgetCard>
      )}

      {mayStock && depotId != null && (
        <WidgetCard
          title={t('insight.stock.wasteTitle')}
          source={wastage}
          isEmpty={(d) => d.byItem.length === 0}
          emptyText={t('insight.stock.wasteEmpty')}
          detailHref="/dashboard/wastage"
        >
          {(d) => (
            <div className="flex flex-col gap-2">
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {[...d.byItem]
                  .sort((a, b) => (b.lossIdr ?? 0) - (a.lossIdr ?? 0) || b.qty - a.qty)
                  .slice(0, TOP)
                  .map((i) => (
                    <li key={i.label} className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-semibold">{i.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {i.lossIdr != null
                          ? t('insight.stock.wasteLine', { qty: i.qty, loss: formatIDR(i.lossIdr) })
                          : t('insight.stock.wasteQty', { qty: i.qty })}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="text-[11px] text-muted">{t('insight.stock.wasteNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
