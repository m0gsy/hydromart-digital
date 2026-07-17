'use client';

import Link from 'next/link';
import { CaretRight, Package, Truck, Warning } from '@phosphor-icons/react';

import { APPROVALS } from '@/components/manager-mobile/approval-placeholder';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { ExecutiveDashboard } from '@/lib/types';

function firstName(name: string | null | undefined): string {
  if (!name) return 'Manajer';
  return name.split(/\s+/)[0] ?? 'Manajer';
}

function Kpis({ d }: { d: ExecutiveDashboard }) {
  const orders = (d.sales?.buckets ?? []).reduce((s, b) => s + b.orderCount, 0);
  const revenue = (d.sales?.buckets ?? []).reduce((s, b) => s + b.revenue, 0);
  // ponytail: no gallon KPI in the dashboard BFF — delivered count is the closest real
  // figure; swap for a gallon metric when dashboard-service exposes one.
  const gallons = d.deliverySla?.totalDelivered ?? 0;
  const sla = d.deliverySla ? Math.round(d.deliverySla.slaRate * 100) : null;

  return (
    <Card className="grid grid-cols-2 gap-y-4 p-5">
      <Kpi label="Order" value={orders.toLocaleString('id-ID')} />
      <Kpi label="Pendapatan" value={<Money amount={revenue} />} />
      <Kpi label="Galon terkirim" value={gallons.toLocaleString('id-ID')} />
      <Kpi label="SLA tepat waktu" value={sla === null ? '—' : `${sla}%`} />
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xl font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

function Tile({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col gap-2 rounded-2xl border border-app bg-[color:var(--surface)] p-4"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        {icon}
      </span>
      <div className="text-sm font-extrabold">{label}</div>
      <div className="text-[11px] text-[color:var(--text-muted)]">{hint}</div>
    </Link>
  );
}

export default function ManagerHomePage() {
  const { customer } = useAuth();
  const { selected, depots } = useDepot();
  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(), true), []);

  const depotName =
    selected?.name ??
    depots.find((dep) => dep.id === customer?.assignedDepotId)?.name ??
    'Depot kamu';
  const pending = APPROVALS.length;

  return (
    <div className="space-y-4 px-4 py-6">
      <header>
        <p className="text-sm text-[color:var(--text-muted)]">Halo,</p>
        <h1 className="text-xl font-extrabold tracking-tight">{firstName(customer?.fullName)}</h1>
        <p className="mt-0.5 text-[12.5px] font-semibold text-brand-700">{depotName}</p>
      </header>

      {dash.loading ? (
        <Skeleton className="h-36 w-full" />
      ) : dash.error || !dash.data ? (
        <ErrorState message={dash.error ?? 'Gagal memuat'} onRetry={dash.reload} />
      ) : (
        <Kpis d={dash.data} />
      )}

      {pending > 0 && (
        <Link
          href="/m/manager/approvals"
          className="flex items-center justify-between rounded-2xl bg-brand-600 p-4 text-on-brand"
        >
          <span className="text-sm font-extrabold">{pending} menunggu approval</span>
          <CaretRight size={18} weight="bold" />
        </Link>
      )}

      <div className="flex gap-3">
        <Tile
          href="/m/manager/pricing"
          icon={<Warning size={19} weight="fill" />}
          label="Stok kritis"
          hint="Cek harga & stok depot"
        />
        <Tile
          href="/m/manager/team"
          icon={<Truck size={19} weight="fill" />}
          label="Kurir aktif"
          hint="Lihat performa tim"
        />
      </div>

      <Link
        href="/m/manager/notifications"
        className="flex items-center gap-3 rounded-2xl border border-app bg-[color:var(--surface)] p-4"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Package size={19} weight="fill" />
        </span>
        <span className="flex-1 text-sm font-semibold">Notifikasi operasional</span>
        <CaretRight size={15} className="text-[color:var(--text-muted)]" />
      </Link>
    </div>
  );
}
