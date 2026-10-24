'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { GallonIssueSummary, GallonOutstanding, GallonReturnSummary } from '@/lib/types';

const dash = '—';

/** Galon & Deposit: empties out in the field, and the deposit held against them. */
export function GallonsTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, depotId, depotNames } = ctx;
  const mayDepot = can('returnsRead', role);
  const mayNetwork = can('returnsReadFinance', role);

  const issued = useInsightData(
    () => api.get<GallonIssueSummary>(endpoints.gallonIssues.summary(depotId as string), true),
    [depotId],
    mayDepot && depotId != null,
  );
  const returned = useInsightData(
    () => api.get<GallonReturnSummary>(endpoints.returns.summary(depotId as string), true),
    [depotId],
    mayDepot && depotId != null,
  );
  const network = useInsightData(
    () => api.get<GallonOutstanding[]>(endpoints.gallonNetwork.outstanding, true),
    [],
    mayNetwork,
  );

  const rows = (network.data ?? [])
    // The network answer is not scoped for every role, so only depots this reader can name stay.
    .filter((d) => depotNames[d.depotId] != null && (depotId == null || d.depotId === depotId))
    // Most empties still out first: that is where the follow-up is.
    .sort((a, b) => b.outstanding - a.outstanding);
  const sum = (key: keyof GallonOutstanding) =>
    rows.reduce((n, r) => n + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);
  const columns: { key: keyof GallonOutstanding; label: string; money?: boolean }[] = [
    { key: 'issued', label: 'insight.gallons.col.issued' },
    { key: 'returned', label: 'insight.gallons.col.returned' },
    { key: 'outstanding', label: 'insight.gallons.col.outstanding' },
    { key: 'depositHeld', label: 'insight.gallons.col.depositHeld', money: true },
    { key: 'depositRefunded', label: 'insight.gallons.col.depositRefunded', money: true },
    { key: 'netDeposit', label: 'insight.gallons.col.netDeposit', money: true },
  ];
  const cell = (n: number, money?: boolean) => (money ? formatIDR(n) : String(n));

  return (
    <div className="flex flex-col gap-6">
      {mayDepot && depotId == null && (
        <p className="text-xs text-muted">{t('insight.gallons.needDepot')}</p>
      )}

      {mayDepot && depotId != null && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!issued.forbidden && (
            <>
              <KpiCard
                label={t('insight.gallons.issuedGallons')}
                value={issued.data ? String(issued.data.gallons) : dash}
                hint={t('insight.gallons.sinceStart')}
                definition={t('insight.gallons.issuedDef')}
              />
              <KpiCard
                label={t('insight.gallons.depositHeld')}
                value={issued.data ? formatIDR(issued.data.depositHeld) : dash}
                hint={t('insight.gallons.sinceStart')}
                definition={t('insight.gallons.depositHeldDef')}
              />
            </>
          )}
          {!returned.forbidden && (
            <>
              <KpiCard
                label={t('insight.gallons.returnedGallons')}
                value={returned.data ? String(returned.data.gallons) : dash}
                hint={t('insight.gallons.sinceStart')}
                definition={t('insight.gallons.returnedDef')}
              />
              <KpiCard
                label={t('insight.gallons.damaged')}
                value={returned.data ? String(returned.data.damaged) : dash}
                hint={t('insight.gallons.sinceStart')}
                definition={t('insight.gallons.damagedDef')}
                goodWhen="down"
              />
            </>
          )}
        </section>
      )}

      {mayNetwork && (
        <WidgetCard
          title={t('insight.gallons.networkTitle')}
          source={network}
          isEmpty={() => rows.length === 0}
          emptyText={t('insight.gallons.networkEmpty')}
          detailHref="/hq/compare"
        >
          {() => (
            <div className="flex flex-col gap-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-xs">
                  <thead>
                    <tr>
                      <th scope="col" className="p-2 text-left font-medium text-muted">
                        {t('insight.finance.depot')}
                      </th>
                      {columns.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className="p-2 text-right font-medium text-muted"
                        >
                          {t(c.label)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.depotId}>
                        <th scope="row" className="p-2 text-left font-semibold">
                          {depotNames[r.depotId] ?? r.depotId.slice(0, 8)}
                        </th>
                        {columns.map((c) => (
                          <td key={c.key} className="p-2 text-right tabular-nums">
                            {cell(r[c.key] as number, c.money)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {depotId == null && (
                    <tfoot>
                      <tr>
                        <th scope="row" className="p-2 text-left font-bold">
                          {t('insight.finance.total')}
                        </th>
                        {columns.map((c) => (
                          <td key={c.key} className="p-2 text-right font-bold tabular-nums">
                            {cell(sum(c.key), c.money)}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <p className="text-[11px] text-muted">{t('insight.gallons.networkNote')}</p>
            </div>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
