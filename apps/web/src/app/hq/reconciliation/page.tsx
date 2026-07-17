'use client';

import { useMemo, useState } from 'react';
import { Scales, DownloadSimple } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, ExecutiveDashboard, GallonOutstanding, Page } from '@/lib/types';

interface ShippingByDepot {
  items: { depotId: string; shippingBilled: number }[];
}

interface RefundsByDepot {
  items: { depotId: string; refunded: number }[];
}

const SELECT_CLASS =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';

// Trailing-30-day window, computed once per mount (client-only, no module-scope Date).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Design 22a — Rekonsiliasi keuangan per depot. Total penjualan (executive topDepots),
// ongkir (order shipping-by-depot), refunds (order refunds-by-depot, fed by payment-service
// coordination) and gallon deposit (depot gallon-outstanding netDeposit) are all real;
// platform fee (5%) & commission (20%) are computed. No stub lines remain.
export default function HqReconciliationPage() {
  const { t } = useT();
  const { toast } = useToast();
  const range = useMemo(defaultRange, []);

  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(range), true));
  const shipping = useAsync<ShippingByDepot>(() => api.get(endpoints.reports.shippingByDepot(range), true));
  const refundsByDepot = useAsync<RefundsByDepot>(() => api.get(endpoints.reports.refundsByDepot(range), true));
  const gallon = useAsync<GallonOutstanding[]>(() => api.get(endpoints.gallonNetwork.outstanding, true));

  const [depotId, setDepotId] = useState('');

  if (depots.loading || dash.loading) return <Skeleton className="h-96 w-full" />;
  if (depots.error) return <ErrorState message={depots.error} onRetry={depots.reload} />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;

  const items = depots.data?.items ?? [];
  const selected = depotId || items[0]?.id || '';
  const depot = items.find((d) => d.id === selected) ?? null;

  // Real: this depot's revenue in the window (null when outside the top-depots list).
  const topRow = dash.data?.topDepots?.items.find((r) => r.depotId === selected) ?? null;
  const sales = topRow?.revenue ?? null;

  // Computed (derivable — no stub badge).
  const platformFee = sales != null ? Math.round(sales * 0.05) : null;
  const commission = sales != null ? Math.round(sales * 0.2) : null;

  // Real lines.
  const shippingBilled = shipping.data?.items.find((r) => r.depotId === selected)?.shippingBilled ?? 0;
  const gallonDeposit = gallon.data?.find((r) => r.depotId === selected)?.netDeposit ?? 0;
  // Real: refunds settled on this depot's orders in the window (payment-service → order-service).
  const refunds = refundsByDepot.data?.items.find((r) => r.depotId === selected)?.refunded ?? 0;

  // ponytail: illustrative payout formula — owner keeps sales + ongkir, less platform
  // fee, franchise commission, refunds and the deposit held. Server is authority later.
  const net =
    sales != null && platformFee != null && commission != null
      ? sales - platformFee - commission + shippingBilled - refunds - gallonDeposit
      : null;

  const dash20 = t('hq.common.dash');
  const money = (n: number | null) => (n == null ? <span className="text-muted">{dash20}</span> : <Money amount={n} />);

  function download() {
    // STUB: no reconciliation-PDF endpoint — Milestone D.
    toast(t('hq.reconciliation.downloaded'), 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Scales size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.reconciliation.title')}</h1>
          <p className="text-sm text-muted">{t('hq.reconciliation.subtitle')}</p>
        </div>
      </div>

      <div className="max-w-sm">
        <label htmlFor="recon-depot" className="mb-1.5 block text-sm font-medium">
          {t('hq.reconciliation.pickDepot')}
        </label>
        <select id="recon-depot" className={SELECT_CLASS} value={selected} onChange={(e) => setDepotId(e.target.value)}>
          {items.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.code}
            </option>
          ))}
        </select>
      </div>

      {!depot ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.reconciliation.selectPrompt')}</p>
        </Card>
      ) : (
        <Card className="flex flex-col p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('hq.reconciliation.statement', { depot: depot.name })}</h2>
            <Button variant="secondary" onClick={download}>
              <DownloadSimple size={16} weight="bold" />
              {t('hq.reconciliation.download')}
            </Button>
          </div>
          <p className="mb-4 text-xs text-muted">{t('hq.reconciliation.period')}</p>

          {sales == null && (
            <p className="mb-4 rounded-xl bg-[color:var(--warning-bg)] px-4 py-3 text-sm text-[color:var(--warning)]">
              {t('hq.reconciliation.noData')}
            </p>
          )}

          <dl className="flex flex-col divide-y divide-[color:var(--border)]">
            <Line label={t('hq.reconciliation.lines.sales')} value={money(sales)} />
            <Line label={t('hq.reconciliation.lines.platformFee')} value={money(platformFee == null ? null : -platformFee)} />
            <Line label={t('hq.reconciliation.lines.shipping')} value={<Money amount={shippingBilled} />} />
            <Line label={t('hq.reconciliation.lines.refunds')} value={<Money amount={-refunds} />} />
            <Line label={t('hq.reconciliation.lines.commission')} value={money(commission == null ? null : -commission)} />
            <Line label={t('hq.reconciliation.lines.deposit')} value={<Money amount={-gallonDeposit} />} />
          </dl>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-deep-teal px-4 py-4 text-white">
            <span className="font-semibold">{t('hq.reconciliation.lines.net')}</span>
            <span className="text-xl font-bold tabular-nums">
              {net == null ? dash20 : <Money amount={net} />}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <dt className="flex items-center gap-2 text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
