'use client';

import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { GroupCount, HrDashboard } from '@/lib/hr';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { monthWib } from '@/lib/wib';

const dash = '—';

/** The count for one key of a grouped answer, zero when that key did not come back. */
const countOf = (groups: readonly GroupCount[] | undefined, key: string): number =>
  groups?.find((g) => g.key === key)?.count ?? 0;

/** The attendance statuses shown, in the order a reader scans them. */
const ATTENDANCE = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE'] as const;

/**
 * SDM & Tim: who is at work today, and what needs HR's attention.
 *
 * The payroll AMOUNTS in the answer are left out on purpose: the dashboard endpoint is open to
 * the whole `hrView` group, which includes roles with no payroll read. What this shows of payroll
 * is how many are in each status.
 */
export function PeopleTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotId } = ctx;
  const mayView = can('hrView', role);
  // Payroll is a month; the window's first day names it.
  const period = monthWib(new Date(range.from));

  const hr = useInsightData(
    () =>
      api.get<HrDashboard>(
        endpoints.hr.dashboard({ depotId: depotId ?? undefined, periodMonth: period }),
        true,
      ),
    [depotId, period],
    mayView,
  );
  const d = hr.data;

  return (
    <div className="flex flex-col gap-6">
      {mayView && !hr.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t('insight.people.headcount')}
            value={d ? String(d.headcount.total) : dash}
            definition={t('insight.people.headcountDef')}
          />
          {ATTENDANCE.map((status) => (
            <KpiCard
              key={status}
              label={t(`insight.people.attendance.${status}`)}
              value={d ? String(countOf(d.attendanceToday, status)) : dash}
              hint={d ? t('insight.people.today', { date: d.workDate }) : undefined}
              definition={t('insight.people.attendanceDef')}
              goodWhen={status === 'PRESENT' ? 'up' : 'down'}
            />
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mayView && (
          <WidgetCard
            title={t('insight.people.payrollTitle', { month: period })}
            source={hr}
            isEmpty={(x) => x.payroll.totals.count === 0}
            emptyText={t('insight.people.payrollEmpty')}
            detailHref="/hr/payroll"
          >
            {(x) => (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {x.payroll.byStatus.map((g) => (
                  <li key={g.key} className="flex justify-between gap-2">
                    <span>{t(`insight.people.payrollStatus.${g.key}`)}</span>
                    <span className="font-semibold tabular-nums">{g.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}

        {mayView && (
          <WidgetCard
            title={t('insight.people.endingTitle')}
            source={hr}
            isEmpty={(x) => x.employmentsEnding.length === 0}
            emptyText={t('insight.people.endingEmpty')}
            detailHref="/hr/employees"
          >
            {(x) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {x.employmentsEnding.slice(0, 5).map((e) => (
                  <li key={e.employeeId} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{e.fullName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {e.contractEndDate}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}

        {mayView && (
          <WidgetCard
            title={t('insight.people.documentsTitle')}
            source={hr}
            isEmpty={(x) => x.documentsExpiring.length === 0}
            emptyText={t('insight.people.documentsEmpty')}
            detailHref="/hr/employees"
          >
            {(x) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {x.documentsExpiring.slice(0, 5).map((e, i) => (
                  <li key={`${e.employeeId}-${e.type}-${i}`} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{e.fullName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{e.expiresAt}</span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}
      </div>
    </div>
  );
}
