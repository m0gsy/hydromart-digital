'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, MapPin, Package, Receipt, Users, Wallet } from '@phosphor-icons/react';

import { DepotForm } from '@/components/hq/depot-form';
import { DepotSuspendDialog } from '@/components/hq/depot-suspend-dialog';
import { StockBar } from '@/components/hq/charts';
import { StubBadge } from '@/lib/hq/stubs';
import { Badge, Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, InventoryItem, NetworkDashboard, Order, Page } from '@/lib/types';

function range30(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Tile({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {label}
        {badge}
      </p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

export default function HqDepotDetailPage() {
  const { t } = useT();
  const param = useParams();
  const id = (Array.isArray(param.id) ? param.id[0] : param.id) ?? '';
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);

  const depot = useAsync<DepotAdmin>(() => api.get(endpoints.depots.detail(id), true), [id]);
  const rollup = useAsync<NetworkDashboard>(() => api.get(endpoints.hq.rollup(range30()), true));
  const inv = useAsync<InventoryItem[]>(() => api.get(endpoints.inventory.lines(id), true), [id]);
  const orders = useAsync<Page<Order>>(() =>
    api.get(endpoints.orders.manage({ depotId: id, limit: 5 }), true),
  );

  if (depot.loading) return <Skeleton className="h-96 w-full" />;
  if (depot.error) return <ErrorState message={depot.error} onRetry={depot.reload} />;
  if (!depot.data) return <p className="text-sm text-muted">{t('hq.depotDetail.notFound')}</p>;

  const d = depot.data;
  const perf = rollup.data?.depots.find((x) => x.depotId === id);
  const slaPct = perf?.slaRate != null ? Math.round(perf.slaRate * 100) : null;

  // Reactivate is a direct, low-risk PATCH; suspend is destructive → guarded dialog.
  async function reactivate() {
    setBusy(true);
    try {
      await api.patch(endpoints.depots.detail(id), { active: true }, true);
      depot.reload();
    } catch (err) {
      // Surfaced by the reload path; keep it non-fatal.
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setBusy(false);
    }
  }

  const invItems = inv.data ?? [];
  const orderItems = orders.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/hq/depots"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
        >
          <ArrowLeft size={16} weight="bold" />
          {t('hq.depotDetail.back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{d.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="font-mono">{d.code}</span>
              <Badge tone={d.ownershipType === 'WARALABA' ? 'warning' : 'brand'}>
                {d.ownershipType === 'WARALABA'
                  ? t('hq.depots.ownership.franchise')
                  : t('hq.depots.ownership.central')}
              </Badge>
              <Badge tone={d.active ? 'success' : 'neutral'}>
                {d.active ? t('hq.depots.status.active') : t('hq.depots.status.suspended')}
              </Badge>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing((v) => !v)} disabled={busy}>
              {t('hq.depotDetail.edit')}
            </Button>
            {d.active ? (
              <Button variant="danger" onClick={() => setSuspendOpen(true)} disabled={busy}>
                {t('hq.depotDetail.suspend')}
              </Button>
            ) : (
              <Button variant="primary" onClick={reactivate} loading={busy}>
                {t('hq.depotDetail.reactivate')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <DepotForm
          key={d.id}
          depot={d}
          onDone={() => {
            setEditing(false);
            depot.reload();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={t('hq.depotDetail.kpi.revenue')}
          value={perf ? `Rp ${perf.revenue.toLocaleString('id-ID')}` : t('hq.common.dash')}
        />
        <Tile
          label={t('hq.depotDetail.kpi.orders')}
          value={perf ? String(perf.orderCount) : t('hq.common.dash')}
        />
        <Tile
          label={t('hq.depotDetail.kpi.sla')}
          value={slaPct != null ? `${slaPct}%` : t('hq.common.dash')}
        />
        <Tile
          label={t('hq.depotDetail.kpi.rating')}
          value={perf?.rating != null ? perf.rating.toFixed(1) : t('hq.common.dash')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coverage & configuration */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <MapPin size={18} weight="fill" className="text-brand-500" />
            {t('hq.depotDetail.config.title')}
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">{t('hq.depotDetail.config.radius')}</dt>
              <dd className="font-semibold tabular-nums">
                {t('hq.depotDetail.config.radiusKm', { n: d.serviceRadiusKm })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('hq.depotDetail.config.fee')}</dt>
              <dd className="font-semibold">
                <Money amount={d.deliveryFee} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('hq.depotDetail.config.minOrder')}</dt>
              <dd className="font-semibold">
                {d.minOrderAmount == null ? t('hq.common.dash') : <Money amount={d.minOrderAmount} />}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('hq.depotDetail.config.coords')}</dt>
              <dd className="font-mono text-xs">
                {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted">{d.address}</p>
        </Card>

        {/* Stock health */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Package size={18} weight="fill" className="text-brand-500" />
            {t('hq.depotDetail.stock.title')}
          </h2>
          {inv.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : invItems.length === 0 ? (
            <p className="text-sm text-muted">{t('hq.depotDetail.stock.empty')}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {invItems.slice(0, 8).map((it) => (
                <StockBar
                  key={it.id}
                  label={it.label}
                  value={it.available}
                  max={Math.max(it.minimumStock * 2, it.quantity, 1)}
                  low={it.lowStock}
                  unit={it.unit}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Depot staff — no per-depot filter yet */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users size={18} weight="fill" className="text-brand-500" />
            {t('hq.depotDetail.staff.title')}
            <StubBadge />
          </h2>
          <p className="text-sm text-muted">{t('hq.depotDetail.staff.stub')}</p>
        </Card>

        {/* Recent orders */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Receipt size={18} weight="fill" className="text-brand-500" />
            {t('hq.depotDetail.orders.title')}
          </h2>
          {orders.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : orderItems.length === 0 ? (
            <p className="text-sm text-muted">{t('hq.depotDetail.orders.empty')}</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {orderItems.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{o.orderNumber}</span>
                    <span className="block text-xs text-muted">{o.status}</span>
                  </span>
                  <Money amount={o.total} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Pending franchise payout — deep-teal, no HQ endpoint yet */}
      <Card className="flex flex-col gap-2 border-0 bg-deep-teal p-5 text-white">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wallet size={18} weight="fill" />
          {t('hq.depotDetail.payout.title')}
          <StubBadge />
        </h2>
        <p className="text-sm text-white/70">{t('hq.depotDetail.payout.body')}</p>
      </Card>

      {suspendOpen && (
        <DepotSuspendDialog
          depot={{ id: d.id, code: d.code, name: d.name }}
          onClose={() => setSuspendOpen(false)}
          onSuspended={() => {
            setSuspendOpen(false);
            depot.reload();
          }}
        />
      )}
    </div>
  );
}
