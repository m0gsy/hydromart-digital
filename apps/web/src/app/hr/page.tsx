'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import type { ReactNode } from 'react';

import { Card, CenterState, ErrorState, Money, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  ATTENDANCE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  PAYROLL_STATUS_LABEL,
  currentPeriod,
  type AttendanceStatus,
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

function Groups({ rows, label }: { rows: { key: string; count: number }[]; label: (k: string) => string }) {
  const { t } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted">{t('hrFix.home.empty')}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((r) => (
        <span key={r.key} className="rounded-lg bg-[color:var(--surface-muted)] px-3 py-1.5 text-sm">
          {label(r.key)}: <b className="tabular-nums">{r.count}</b>
        </span>
      ))}
    </div>
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
      <SectionHeader title={t('hrFix.home.title')} subtitle={`Periode ${period}`} />

      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('hrFix.home.totalEmployees')} value={data.headcount.total} />
            <Stat label={t('hrFix.home.payrollNet')} value={<Money amount={data.payroll.totals.net} />} />
            <Stat label={t('hrFix.home.runPayroll')} value={data.payroll.totals.count} />
            <Stat label={t('hrFix.home.presentToday')} value={data.attendanceToday.find((g) => g.key === 'PRESENT')?.count ?? 0} />
          </div>

          <Card className="space-y-3 p-5">
            <h3 className="font-bold">{t('hrFix.home.headcountMix')}</h3>
            <Groups rows={data.headcount.byEmploymentStatus} label={(k) => t(EMPLOYMENT_STATUS_LABEL[k as EmploymentStatus]) ?? k} />
          </Card>

          <Card className="space-y-3 p-5">
            <h3 className="font-bold">Absensi Hari Ini ({data.workDate})</h3>
            <Groups rows={data.attendanceToday} label={(k) => t(ATTENDANCE_STATUS_LABEL[k as AttendanceStatus]) ?? k} />
          </Card>

          <Card className="space-y-3 p-5">
            <h3 className="font-bold">Payroll {data.periodMonth}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-muted">{t('hrFix.home.gross')}</p><Money amount={data.payroll.totals.gross} className="font-bold" /></div>
              <div><p className="text-muted">{t('hrFix.home.bonus')}</p><Money amount={data.payroll.totals.totalBonus} className="font-bold" /></div>
              <div><p className="text-muted">{t('hrFix.home.deduction')}</p><Money amount={data.payroll.totals.totalDeduction} className="font-bold" /></div>
              <div><p className="text-muted">{t('hrFix.home.net')}</p><Money amount={data.payroll.totals.net} className="font-bold" /></div>
            </div>
            <Groups rows={data.payroll.byStatus} label={(k) => t(PAYROLL_STATUS_LABEL[k as PayrollStatus]) ?? k} />
          </Card>

          <div className="flex flex-wrap gap-3">
            <Link href="/hr/employees" className="text-sm font-semibold text-brand-700 hover:underline">{t('hrFix.home.manageEmployees')}</Link>
            <Link href="/hr/payroll" className="text-sm font-semibold text-brand-700 hover:underline">{t('hrFix.home.runPayrollLink')}</Link>
            <Link href="/hr/reports" className="text-sm font-semibold text-brand-700 hover:underline">{t('hrFix.home.downloadReport')}</Link>
          </div>
        </>
      )}
      {data && data.headcount.total === 0 && (
        <CenterState title={t('hrFix.home.noEmployees')}>{t('hrFix.home.addFirst')}</CenterState>
      )}
    </div>
  );
}
