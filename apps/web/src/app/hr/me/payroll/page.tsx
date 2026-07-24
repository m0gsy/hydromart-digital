'use client';

import Link from 'next/link';

import { Badge, Card, CenterState, ErrorState, Money, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { PAYROLL_STATUS_LABEL, fmtDate, type HrPage, type Payroll, type PayrollStatus } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const TONE: Record<PayrollStatus, 'neutral' | 'success' | 'brand'> = { DRAFT: 'neutral', APPROVED: 'brand', PAID: 'success' };

export default function MyPayrollPage() {
  const { data, error, loading, reload } = useAsync<HrPage<Payroll>>(
    () => api.get<HrPage<Payroll>>(endpoints.hr.payrollMe({ pageSize: 24 }), true),
    [],
  );

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title="Slip Gaji Saya" />
      {loading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <CenterState title="Belum ada slip gaji">Slip gaji kamu akan muncul di sini.</CenterState>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((p) => (
            <Link key={p.id} href={`/hr/payroll/${p.id}`} className="flex items-center justify-between gap-2 p-4 hover:bg-brand-50">
              <div>
                <p className="font-semibold tabular-nums">{p.periodMonth}</p>
                <p className="text-xs text-muted">{p.presentDays} hari · {fmtDate(p.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2">
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
