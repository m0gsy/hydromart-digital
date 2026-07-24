'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

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
      toast('Isi employeeId untuk generate', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(endpoints.hr.generatePayroll, { employeeId, periodMonth: period }, true);
      toast('Payroll digenerate');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal generate', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title="Payroll" subtitle={`Periode ${period}`} />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">Periode<Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <label className="text-sm">Employee ID (opsional)<Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="UUID karyawan" className="w-64" /></label>
        {canRunPayroll(customer?.role) && <Button onClick={generate} loading={busy}>Generate</Button>}
      </Card>

      {loading && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">Belum ada payroll periode ini.</Card>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((p) => (
            <Link key={p.id} href={`/hr/payroll/${p.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-brand-50">
              <div>
                <p className="font-semibold tabular-nums">{p.periodMonth}</p>
                <p className="text-xs text-muted">{p.presentDays} hari hadir · dibuat {fmtDate(p.createdAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <Money amount={Number(p.net)} className="font-bold" />
                <Badge tone={TONE[p.status]}>{PAYROLL_STATUS_LABEL[p.status]}</Badge>
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
