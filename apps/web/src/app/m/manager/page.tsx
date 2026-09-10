'use client';

import Link from 'next/link';
import { CaretRight, Motorcycle, Package, Tag, WarningOctagon } from '@phosphor-icons/react';

import { Card, ErrorState, LoadError, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ApprovalCounts, Delivery, ExecutiveDashboard, InventoryItem, Page } from '@/lib/types';

function firstName(name: string | null | undefined): string {
  if (!name) return 'Manajer';
  return name.split(/\s+/)[0] ?? 'Manajer';
}

function Kpis({ d }: { d: ExecutiveDashboard }) {
  const { t } = useT();
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
      <Kpi label={t('hrFix.managerHome.gallonsDelivered')} value={gallons.toLocaleString('id-ID')} />
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

function StatTile({
  href,
  icon,
  count,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  count: number | null;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col gap-1.5 rounded-2xl border border-app bg-[color:var(--surface)] p-4"
    >
      {icon}
      <div className="text-xl font-extrabold tabular-nums">{count == null ? '—' : count}</div>
      <div className="text-[11px] font-bold text-[color:var(--text-muted)]">{label}</div>
    </Link>
  );
}

/** Every ON_DELIVERY row for one depot, paged at the cap both the DTO and the service impose. */
async function readAllOnDelivery(depotId: string): Promise<Page<Delivery>> {
  const LIMIT = 100;
  const items: Delivery[] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const p = await api.get<Page<Delivery>>(
      endpoints.deliveries.list({ status: 'ON_DELIVERY', limit: LIMIT, page, depotId }),
      true,
    );
    items.push(...p.items);
    total = p.total;
    if (p.items.length < LIMIT || items.length >= total) return { ...p, items, total };
  }
}

export default function ManagerHomePage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { selected, depots, scopedId, ready } = useDepot();
  // The KPI card is the depot named in the header, not the network. It asked for the
  // unscoped executive dashboard — every depot's orders and every depot's revenue — and
  // printed the answer directly under one depot's name. The scoped id goes in the request;
  // the server refuses it if this account is not responsible for that depot.
  const dash = useAsync<ExecutiveDashboard>(
    () =>
      scopedId
        ? api.get(endpoints.dashboard.executive({ depotId: scopedId }), true)
        : Promise.resolve(null as unknown as ExecutiveDashboard),
    [scopedId],
  );
  const counts = useAsync<ApprovalCounts>(
    () => (scopedId ? api.get(endpoints.approvals.counts(scopedId), true) : Promise.resolve(null as unknown as ApprovalCounts)),
    [scopedId],
  );
  // Real home-tile counts: low-stock lines (depot-service) + couriers on delivery network-wide.
  const lowStock = useAsync<InventoryItem[]>(
    () => (scopedId ? api.get(endpoints.inventory.lines(scopedId, { lowStockOnly: true }), true) : Promise.resolve([])),
    [scopedId],
  );
  /*
   * CA-4-51 — the "Kurir aktif" tile counted DELIVERIES, so one courier carrying four
   * orders read as four couriers, and the number sat under one depot's name while the
   * request asked for the whole network.
   *
   * Distinct `driverId` is the count the tile claims, and the depot goes in the request:
   * a depot-locked manager was already forced to their own depot by the route, but an HQ
   * account or a manager over several depots was not, and that is who saw the network
   * number captioned as one depot's.
   */
  /*
   * `limit: 200` was a 400 EVERY time, so this tile has never rendered a number: both the
   * DTO (`@Max(100)`) and the service (`MAX_LIMIT = 100`) refuse anything above 100, and the
   * screen turned the refusal into its own error row. Third instance of one defect — see
   * `test/page-size-caps.test.ts`, which now refuses the shape repo-wide.
   *
   * Paged rather than clamped: clamping to 100 would ship a number that silently undercounts
   * the depot with 101 deliveries in flight, which is exactly the depot whose count matters.
   */
  const onDelivery = useAsync<Page<Delivery>>(
    () =>
      scopedId
        ? readAllOnDelivery(scopedId)
        : Promise.resolve(null as unknown as Page<Delivery>),
    [scopedId],
  );

  const depotName =
    selected?.name ??
    depots.find((dep) => dep.id === customer?.assignedDepotId)?.name ??
    t('hrFix.managerHome.yourDepot');
  const pending = counts.data?.total ?? 0;
  const stockCritical = lowStock.data?.length ?? null;
  const activeCouriers = onDelivery.data
    ? new Set(onDelivery.data.items.map((d) => d.driverId)).size
    : null;

  return (
    <div className="space-y-4 px-4 py-6">
      <header>
        <p className="text-sm text-[color:var(--text-muted)]">Halo,</p>
        <h1 className="text-xl font-extrabold tracking-tight">{firstName(customer?.fullName)}</h1>
        <p className="mt-0.5 text-[12.5px] font-semibold text-brand-700">{depotName}</p>
      </header>

      {dash.loading || !ready ? (
        <Skeleton className="h-36 w-full" />
      ) : dash.error || !dash.data ? (
        <ErrorState message={dash.error ?? t('hrFix.managerHome.loadFailed')} onRetry={dash.reload} />
      ) : (
        <Kpis d={dash.data} />
      )}

      {/* The approval banner hides itself at 0 and both tiles fall back to a dash, so a
          manager whose reads all failed sees a calm depot. */}
      {(counts.error || lowStock.error || onDelivery.error) && (
        <LoadError
          onRetry={() => {
            if (counts.error) counts.reload();
            if (lowStock.error) lowStock.reload();
            if (onDelivery.error) onDelivery.reload();
          }}
        />
      )}

      {pending > 0 && (
        <Link
          href="/m/manager/approvals"
          className="flex items-center justify-between rounded-2xl bg-brand-600 p-4 text-on-brand"
        >
          <span className="text-sm font-extrabold">
            {t('mgrFix.mMgr.pendingApproval', { count: pending })}
          </span>
          <CaretRight size={18} weight="bold" />
        </Link>
      )}

      <div className="flex gap-3">
        <StatTile
          href="/m/manager/notifications"
          icon={<WarningOctagon size={20} weight="fill" className="text-[color:var(--danger)]" />}
          count={stockCritical}
          label={t('mgrFix.mMgr.stockCritical')}
        />
        <StatTile
          href="/m/manager/team"
          icon={<Motorcycle size={20} weight="fill" className="text-brand-700" />}
          count={activeCouriers}
          label={t('mgrFix.mMgr.activeCouriers')}
        />
      </div>

      <Link
        href="/m/manager/notifications"
        className="flex items-center gap-3 rounded-2xl border border-app bg-[color:var(--surface)] p-4"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Package size={19} weight="fill" />
        </span>
        <span className="flex-1 text-sm font-semibold">{t('mgrFix.mMgr.opsNotif')}</span>
        <CaretRight size={15} className="text-[color:var(--text-muted)]" />
      </Link>

      {/* `/m/manager/pricing` was built, translated and shipped in the Ops binary with
          nothing anywhere linking to it — the bottom nav has five tabs and none is this
          one. A row on the console home is the reachable place for it that does not cost
          a sixth tab. */}
      <Link
        href="/m/manager/pricing"
        className="flex items-center gap-3 rounded-2xl border border-app bg-[color:var(--surface)] p-4"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Tag size={19} weight="fill" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">{t('mgrFix.mMgr.pricing')}</span>
          <span className="text-[11.5px] text-[color:var(--text-muted)]">
            {t('mgrFix.mMgr.pricingHint')}
          </span>
        </span>
        <CaretRight size={15} className="text-[color:var(--text-muted)]" />
      </Link>
    </div>
  );
}
