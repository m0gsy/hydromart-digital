'use client';

import { DownloadSimple, Lock, PaperPlaneTilt } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canViewDepotFinance } from '@/lib/roles';
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
  /**
   * "—" here now means one named service could not be read, not "nobody ever built this".
   * The caption says which, because a manager who can see that payroll is the missing term
   * can go and ask for it; a bare dash sends them nowhere.
   */
  const missingTerms = (b: ReportDepotMonthly['profitBreakdown'] | undefined): string => {
    if (!b) return 'butuh data biaya';
    const missing = [
      b.cogsIdr === null ? 'pembelian' : null,
      b.payrollIdr === null ? 'gaji' : null,
      b.opexIdr === null ? 'biaya kas' : null,
    ].filter(Boolean);
    return missing.length > 0 ? `belum terbaca: ${missing.join(', ')}` : 'omzet − pembelian − gaji − biaya';
  };
  const stats: Stat[] = [
    { label: 'Order', value: r ? r.orders.toLocaleString('id-ID') : '—', caption: 'bulan berjalan' },
    { label: 'Pendapatan', value: r ? formatIDR(r.revenueIdr) : '—', caption: 'non-batal' },
    {
      label: 'SLA rata2',
      value: r?.slaPct != null ? `${r.slaPct}%` : '—',
      caption: r?.slaPct != null ? 'pengiriman tepat waktu' : 'belum ada pengiriman terhitung',
    },
    {
      label: 'Laba bersih',
      value: r?.netProfitIdr != null ? formatIDR(r.netProfitIdr) : '—',
      caption: missingTerms(r?.profitBreakdown),
    },
  ];

  /**
   * The arithmetic behind "Laba bersih", spelled out. A net profit nobody can decompose is
   * a number nobody can dispute — and these two costs come from two places that CAN
   * overlap (a purchase order in the system plus a "bayar supplier" line in the cash book),
   * so showing the terms is what makes a double count visible instead of silent.
   */
  const idrOrDash = (v: number | null | undefined): string => (v == null ? '—' : formatIDR(v));
  const profit: Row[] = [
    { label: 'Omzet (non-batal)', value: r ? formatIDR(r.revenueIdr) : '—' },
    { label: 'Pembelian diterima', value: idrOrDash(r?.profitBreakdown.cogsIdr) },
    { label: 'Gaji (net)', value: idrOrDash(r?.profitBreakdown.payrollIdr) },
    { label: 'Biaya kas keluar', value: idrOrDash(r?.profitBreakdown.opexIdr) },
  ];

  // Governance (approval/opname/setoran) is owned by depot-service/payout — no order-service
  // source, so these stay "—" until wired.
  const governance: Row[] = [
    { label: 'Approval ditinjau', value: '—' },
    { label: 'Selisih opname nilai', value: '—' },
    { label: 'Setoran selisih', value: '—' },
  ];

  // Depot SOP: the monthly report is read in galon, in this order and with these words.
  // Omset is the revenue figure already on the stat row above; it is repeated here because
  // the SOP sheet reads as one block and a manager copies it line by line.
  const galon: Row[] = [
    { label: 'Total galon bulan lalu', value: r ? r.prevGallons.toLocaleString('id-ID') : '—' },
    { label: 'Total galon bulan sekarang', value: r ? r.gallons.toLocaleString('id-ID') : '—' },
    {
      label: 'Selisih',
      value: r ? `${r.gallonsDelta > 0 ? '+' : ''}${r.gallonsDelta.toLocaleString('id-ID')}` : '—',
    },
    {
      label: 'Persentase',
      // '—' when last month sold nothing: there is no percentage, and printing +100% off a
      // zero base is a number somebody would take to a meeting.
      value: r?.growthPct != null ? `${r.growthPct > 0 ? '+' : ''}${r.growthPct}%` : '—',
    },
    {
      label: 'Rata-rata per hari',
      value: r ? `${r.avgGallonsPerDay.toLocaleString('id-ID')} galon` : '—',
    },
    { label: 'Omset', value: r ? formatIDR(r.revenueIdr) : '—' },
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

          <Panel title="Penjualan galon" rows={galon} />

          <Panel title="Rincian laba" rows={profit} />

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
  if (!canViewDepotFinance(customer?.role)) {
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
