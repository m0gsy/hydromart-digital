'use client';

import { DownloadSimple, Lock, PaperPlaneTilt } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ReportDepotMonthly } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());
const MONTH_KEY = new Date().toISOString().slice(0, 7); // YYYY-MM

type Stat = { label: string; value: string; caption: string };
type Row = { label: string; value: string };

function Panel({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-sm font-bold text-[color:var(--text-muted)]">{title}</h2>
      <dl className="flex flex-col divide-y divide-[color:var(--border)]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-sm text-[color:var(--text-muted)]">{r.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function MonthlyReviewBody() {
  const { customer } = useAuth();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const depotName = depot ? `${depot.name}` : 'Depot';

  const review = useAsync<ReportDepotMonthly | null>(
    () =>
      depot ? api.get(endpoints.reports.depotMonthly(depot.id, MONTH_KEY), true) : Promise.resolve(null),
    [depot?.id],
  );

  const r = review.data;
  // orders/revenue/activeCustomers/topCourier are real; SLA + net profit have no source ("—").
  const stats: Stat[] = [
    { label: 'Order', value: r ? r.orders.toLocaleString('id-ID') : '—', caption: 'bulan berjalan' },
    { label: 'Pendapatan', value: r ? formatIDR(r.revenueIdr) : '—', caption: 'non-batal' },
    { label: 'SLA rata2', value: r?.slaPct != null ? `${r.slaPct}%` : '—', caption: 'butuh data pengiriman' },
    {
      label: 'Laba bersih',
      value: r?.netProfitIdr != null ? formatIDR(r.netProfitIdr) : '—',
      caption: 'butuh HPP + biaya',
    },
  ];

  // Governance (approval/opname/setoran) is owned by depot-service/payout — no order-service
  // source, so these stay "—" until wired.
  const governance: Row[] = [
    { label: 'Approval ditinjau', value: '—' },
    { label: 'Selisih opname nilai', value: '—' },
    { label: 'Setoran selisih', value: '—' },
  ];

  const team: Row[] = [
    { label: 'Kurir teratas', value: r?.topCourier ? `${r.topCourier.name} · ${r.topCourier.delivered} antar` : '—' },
    { label: 'Pelanggan aktif', value: r ? r.activeCustomers.toLocaleString('id-ID') : '—' },
    { label: 'Dipulihkan dari churn', value: '—' },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Card elevated className="flex flex-col gap-1 bg-brand-700 p-6 text-on-brand">
        <p className="text-sm font-medium text-on-brand/80">Tinjauan ops</p>
        <h1 className="text-xl font-bold">
          {MONTH} · {depotName}
        </h1>
        <p className="text-sm text-on-brand/80">
          untuk rapat bulanan head office{customer?.fullName ? ` · ${customer.fullName}` : ''}
        </p>
      </Card>

      {review.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : review.error ? (
        <ErrorState message={review.error} onRetry={review.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <Card key={s.label} className="flex flex-col gap-1 p-4">
                <p className="text-xs text-[color:var(--text-muted)]">{s.label}</p>
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
                <p className="text-[11px] text-[color:var(--text-muted)]">{s.caption}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="Governance" rows={governance} />
            <Panel title="Tim & pelanggan" rows={team} />
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-app px-4 py-2.5 text-sm font-semibold hover:bg-brand-50"
        >
          <DownloadSimple size={18} weight="bold" />
          Unduh PDF
        </button>
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-700"
        >
          <PaperPlaneTilt size={18} weight="fill" />
          Kirim ke head office
        </button>
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Tinjauan ops bulanan hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <MonthlyReviewBody />;
}

export default function MonthlyReviewPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
