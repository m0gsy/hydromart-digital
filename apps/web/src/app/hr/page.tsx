'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import type { ReactNode } from 'react';

import { Badge, Card, CenterState, ErrorState, Money, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  ATTENDANCE_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  PAYROLL_STATUS_LABEL,
  currentPeriod,
  type AttendanceStatus,
  type ExpiringDocument,
  type EmploymentStatus,
  type HrDashboard,
  type PayrollStatus,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
    </Card>
  );
}

function Groups({
  rows,
  label,
}: {
  rows: { key: string; count: number }[];
  label: (k: string) => string;
}) {
  const { t } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t('hrFix.home.empty')}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((r) => (
        <span
          key={r.key}
          className="rounded-lg bg-[color:var(--surface-muted)] px-3 py-1.5 text-sm"
        >
          {label(r.key)}: <b className="tabular-nums">{r.count}</b>
        </span>
      ))}
    </div>
  );
}

/**
 * CA-1-47 — an expiry date nobody ever read.
 *
 * HR typed `expiresAt` on upload and the employee's own page printed it back, and that was
 * the whole life of the field: no query asked which documents were about to lapse, so
 * finding out meant opening every employee one at a time. A courier's SIM expired the same
 * way a contract did — silently, and only a policeman or an audit ever noticed.
 */
function ExpiringDocs({ rows, today }: { rows: ExpiringDocument[]; today: string }) {
  const { t } = useT();
  if (rows.length === 0) return null;
  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-bold">{t('hrFix.home.docsExpiring')}</h3>
      <ul className="divide-y divide-[color:var(--border)]">
        {rows.map((d) => {
          // Both sides are YYYY-MM-DD from the server's own calendar, so this subtracts two
          // local dates rather than two instants — no timezone to get wrong.
          const days = Math.round(
            (Date.parse(`${d.expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
          );
          return (
            <li key={`${d.employeeId}-${d.type}`} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/hr/employees/detail?id=${d.employeeId}`}
                  className="font-semibold hover:underline"
                >
                  {d.fullName}
                </Link>
                <p className="text-sm text-muted">
                  {d.employeeCode} · {t(DOCUMENT_TYPE_LABEL[d.type])} · {d.expiresAt}
                </p>
              </div>
              <Badge tone={days < 0 ? 'danger' : 'warning'}>
                {days < 0 ? t('hrFix.home.docsExpired') : t('hrFix.home.docsDaysLeft', { days })}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function HrDashboardPage() {
  const { t } = useT();
  const period = currentPeriod();
  const { data, error, loading, reload } = useAsync<HrDashboard>(
    () => api.get<HrDashboard>(endpoints.hr.dashboard({ periodMonth: period }), true),
    [period],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SectionHeader
        title={t('hrFix.home.title')}
        subtitle={t('hrFix.common.periodLabel', { period })}
      />

      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('hrFix.home.totalEmployees')} value={data.headcount.total} />
            <Stat
              label={t('hrFix.home.payrollNet')}
              value={<Money amount={data.payroll.totals.net} />}
            />
            <Stat label={t('hrFix.home.runPayroll')} value={data.payroll.totals.count} />
            <Stat
              label={t('hrFix.home.presentToday')}
              value={data.attendanceToday.find((g) => g.key === 'PRESENT')?.count ?? 0}
            />
          </div>

          <ExpiringDocs rows={data.documentsExpiring} today={data.workDate} />

          <Card className="space-y-3 p-5">
            <h3 className="font-bold">{t('hrFix.home.headcountMix')}</h3>
            <Groups
              rows={data.headcount.byEmploymentStatus}
              label={(k) => t(EMPLOYMENT_STATUS_LABEL[k as EmploymentStatus]) ?? k}
            />
          </Card>

          <Card className="space-y-3 p-5">
            <h3 className="font-bold">
              {t('hrFix.home.attendanceToday', { date: data.workDate })}
            </h3>
            <Groups
              rows={data.attendanceToday}
              label={(k) => t(ATTENDANCE_STATUS_LABEL[k as AttendanceStatus]) ?? k}
            />
          </Card>

          <Card className="space-y-3 p-5">
            {/* CA-1-87: a translator could not reach this heading, though `nav.payroll`
                beside it has always been a key. */}
            <h3 className="font-bold">
              {t('hrFix.home.payrollPeriod', { period: data.periodMonth })}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted">{t('hrFix.home.gross')}</p>
                <Money amount={data.payroll.totals.gross} className="font-bold" />
              </div>
              <div>
                <p className="text-muted">{t('hrFix.home.bonus')}</p>
                <Money amount={data.payroll.totals.totalBonus} className="font-bold" />
              </div>
              <div>
                <p className="text-muted">{t('hrFix.home.deduction')}</p>
                <Money amount={data.payroll.totals.totalDeduction} className="font-bold" />
              </div>
              <div>
                <p className="text-muted">{t('hrFix.home.net')}</p>
                <Money amount={data.payroll.totals.net} className="font-bold" />
              </div>
            </div>
            <Groups
              rows={data.payroll.byStatus}
              label={(k) => t(PAYROLL_STATUS_LABEL[k as PayrollStatus]) ?? k}
            />
          </Card>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/hr/employees"
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              {t('hrFix.home.manageEmployees')}
            </Link>
            <Link
              href="/hr/payroll"
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              {t('hrFix.home.runPayrollLink')}
            </Link>
            <Link
              href="/hr/reports"
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              {t('hrFix.home.downloadReport')}
            </Link>
          </div>
        </>
      )}
      {data && data.headcount.total === 0 && (
        <CenterState title={t('hrFix.home.noEmployees')}>{t('hrFix.home.addFirst')}</CenterState>
      )}
    </div>
  );
}
