'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatIDR } from '@/lib/format';
import { useOpenIncidents } from '@/lib/insight/use-open-incidents';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { ApprovalCounts, MaintenanceItem, OrderDispute } from '@/lib/types';

const dash = '—';
const TOP = 8;

/**
 * Risiko & Kepatuhan: what is open and needs somebody to act: incidents, disputes, approvals
 * waiting for a decision, and equipment overdue for service.
 *
 * Only counts, categories, amounts and dates are drawn. The complainant's name and phone, the
 * order reference and the free-text description stay on the screens that own them.
 */
export function RiskTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, depotId } = ctx;
  const mayIncidents = can('incidents', role);
  const mayDisputes = can('depotDisputes', role);
  const mayApprove = can('approvals', role);
  const mayMaintain = can('depotMaintenance', role);
  const has = depotId != null;

  const { source: incidentSource, incidents, high } = useOpenIncidents(depotId, mayIncidents);
  const incidentsReady = incidentSource.data != null;
  const disputes = useInsightData(
    () =>
      api.get<OrderDispute[]>(
        endpoints.disputes.list({ depotId: depotId as string, status: 'OPEN' }),
        true,
      ),
    [depotId],
    mayDisputes && has,
  );
  const approvals = useInsightData(
    () => api.get<ApprovalCounts>(endpoints.approvals.counts(depotId as string), true),
    [depotId],
    mayApprove && has,
  );
  const upkeep = useInsightData(
    () => api.get<MaintenanceItem[]>(endpoints.maintenance.list(depotId as string), true),
    [depotId],
    mayMaintain && has,
  );

  const disputeValue = (disputes.data ?? []).reduce((n, d) => n + d.amountIdr, 0);
  const overdue = (upkeep.data ?? []).filter((m) => m.status === 'DUE');

  return (
    <div className="flex flex-col gap-6">
      {(mayIncidents || mayDisputes || mayApprove || mayMaintain) && !has && (
        <p className="text-xs text-muted">{t('insight.risk.needDepot')}</p>
      )}

      {has && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mayIncidents && !incidentSource.forbidden && (
            <KpiCard
              label={t('insight.risk.incidents')}
              value={incidentsReady ? String(incidents.length) : dash}
              hint={incidentsReady ? t('insight.risk.highHint', { n: high }) : undefined}
              definition={t('insight.risk.incidentsDef')}
              tone={incidentsReady && high > 0 ? 'danger' : undefined}
              goodWhen="down"
            />
          )}
          {mayDisputes && !disputes.forbidden && (
            <KpiCard
              label={t('insight.risk.disputes')}
              value={disputes.data ? String(disputes.data.length) : dash}
              hint={disputes.data ? formatIDR(disputeValue) : undefined}
              definition={t('insight.risk.disputesDef')}
              goodWhen="down"
            />
          )}
          {mayApprove && !approvals.forbidden && (
            <KpiCard
              label={t('insight.risk.approvals')}
              value={approvals.data ? String(approvals.data.total) : dash}
              definition={t('insight.risk.approvalsDef')}
              goodWhen="down"
            />
          )}
          {mayMaintain && !upkeep.forbidden && (
            <KpiCard
              label={t('insight.risk.overdue')}
              value={upkeep.data ? String(overdue.length) : dash}
              definition={t('insight.risk.overdueDef')}
              tone={overdue.length > 0 ? 'danger' : undefined}
              goodWhen="down"
            />
          )}
        </section>
      )}

      {mayIncidents && has && (
        <WidgetCard
          title={t('insight.risk.incidentsTitle')}
          source={incidentSource}
          isEmpty={() => incidents.length === 0}
          emptyText={t('insight.risk.incidentsEmpty')}
          detailHref="/dashboard/incidents"
        >
          {() => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {incidents.slice(0, TOP).map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{i.title}</span>
                    <span className="ml-2 text-xs text-muted">
                      {t(`insight.risk.status.${i.status}`)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      i.severity === 'HIGH' ? 'text-[color:var(--danger)]' : 'text-muted'
                    }`}
                  >
                    {t(`insight.risk.severity.${i.severity}`)} · {formatDate(i.createdAt)}
                  </span>
                </li>
              ))}
              {incidents.length > TOP && (
                <li className="text-xs text-muted">
                  {t('insight.risk.more', { count: incidents.length - TOP })}
                </li>
              )}
            </ul>
          )}
        </WidgetCard>
      )}

      {mayDisputes && has && (
        <WidgetCard
          title={t('insight.risk.disputesTitle')}
          source={disputes}
          isEmpty={(d) => d.length === 0}
          emptyText={t('insight.risk.disputesEmpty')}
          detailHref="/dashboard/disputes"
        >
          {(d) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.slice(0, TOP).map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">{t(`insight.risk.category.${x.category}`)}</span>
                  <span className="shrink-0 tabular-nums text-xs">
                    {formatIDR(x.amountIdr)} · {formatDate(x.createdAt)}
                  </span>
                </li>
              ))}
              {d.length > TOP && (
                <li className="text-xs text-muted">
                  {t('insight.risk.more', { count: d.length - TOP })}
                </li>
              )}
            </ul>
          )}
        </WidgetCard>
      )}

      {mayApprove && has && (
        <WidgetCard
          title={t('insight.risk.approvalsTitle')}
          source={approvals}
          isEmpty={(d) => d.total === 0}
          emptyText={t('insight.risk.approvalsEmpty')}
          detailHref="/dashboard/approvals"
        >
          {(d) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {Object.entries(d.byType)
                .filter(([, n]) => n > 0)
                .map(([type, n]) => (
                  <li key={type} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold">{t(`insight.risk.approvalType.${type}`)}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
          )}
        </WidgetCard>
      )}

      {mayMaintain && has && (
        <WidgetCard
          title={t('insight.risk.upkeepTitle')}
          source={upkeep}
          isEmpty={() => overdue.length === 0}
          emptyText={t('insight.risk.upkeepEmpty')}
          detailHref="/dashboard/maintenance"
        >
          {() => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {overdue.slice(0, TOP).map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-semibold">{m.name}</span>
                  <span className="shrink-0 text-xs text-[color:var(--danger)]">
                    {t('insight.risk.dueSince', { date: formatDate(m.nextDueAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      )}
    </div>
  );
}
