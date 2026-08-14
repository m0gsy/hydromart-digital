'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { EmployeeSelect } from '@/components/hr/employee-select';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Input, Money, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { PAYROLL_STATUS_LABEL, currentPeriod, fmtDate, type HrPage, type Payroll, type PayrollStatus } from '@/lib/hr';
import { canRunPayroll } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const TONE: Record<PayrollStatus, 'neutral' | 'success' | 'brand'> = { DRAFT: 'neutral', APPROVED: 'brand', PAID: 'success' };

function PayrollInner() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const prefillEmployee = useSearchParams().get('employeeId') ?? '';
  const [period, setPeriod] = useState(currentPeriod());
  const [employeeId, setEmployeeId] = useState(prefillEmployee);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync<HrPage<Payroll>>(
    () => api.get<HrPage<Payroll>>(endpoints.hr.payroll({ periodMonth: period, employeeId: employeeId || undefined, pageSize: 100 }), true),
    [period, employeeId],
  );

  async function generate() {
    if (!employeeId) {
      toast(t('hrFix.payroll.needEmployeeId'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(endpoints.hr.generatePayroll, { employeeId, periodMonth: period }, true);
      toast(t('hrFix.payroll.generated'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.payroll.generateFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title={t('hrFix.payroll.title')} subtitle={`Periode ${period}`} />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">{t('hrFix.payroll.period')}<Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        {/* G-1. Optional filter, so the empty option means "semua karyawan". */}
        <EmployeeSelect
          value={employeeId}
          onChange={setEmployeeId}
          label={t('hrFix.payroll.employeeOpt')}
          placeholder={t('hrFix.payroll.allEmployees')}
          className="w-64"
        />
        {canRunPayroll(customer?.role) && <Button onClick={generate} loading={busy}>{t('hrFix.payroll.generate')}</Button>}
      </Card>

      {loading && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">{t('hrFix.payroll.empty')}</Card>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((p) => (
            <Link key={p.id} href={`/hr/payroll/detail?id=${p.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-brand-50">
              <div>
                <p className="font-semibold tabular-nums">{p.periodMonth}</p>
                <p className="text-xs text-muted">{p.presentDays} hari hadir · dibuat {fmtDate(p.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <Money amount={Number(p.net)} className="font-bold" />
                <Badge tone={TONE[p.status]}>{t(PAYROLL_STATUS_LABEL[p.status])}</Badge>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

export default function PayrollPage() {
  return <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-4xl" />}><PayrollInner /></Suspense>;
}
