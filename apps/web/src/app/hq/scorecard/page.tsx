'use client';

import { useMemo } from 'react';
import { Trophy } from '@phosphor-icons/react';

import { RankBar } from '@/components/hq/charts';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { NetworkDashboard } from '@/lib/types';

function range30(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Design 22c — depot scorecard. Composite = 70% revenue + 30% SLA, both real from
// the network roll-up (order-service revenue + delivery-service per-depot SLA).
export default function HqScorecardPage() {
  const { t } = useT();
  const range = useMemo(range30, []);
  const dash = useAsync<NetworkDashboard>(() => api.get(endpoints.hq.rollup(range), true));

  if (dash.loading) return <Skeleton className="h-96 w-full" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;

  const items = dash.data?.depots ?? [];
  const maxRevenue = Math.max(1, ...items.map((d) => d.revenue));

  const ranked = items
    .map((d) => {
      const sla = d.slaRate ?? 0; // no delivered orders in range → 0 SLA contribution
      const revScore = d.revenue / maxRevenue;
      return {
        depotId: d.depotId,
        name: d.name,
        revenue: d.revenue,
        orderCount: d.orderCount,
        sla,
        score: revScore * 0.7 + sla * 0.3,
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Trophy size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.scorecard.title')}</h1>
          <p className="text-sm text-muted">{t('hq.scorecard.subtitle')}</p>
        </div>
      </div>

      <p className="text-[12.5px] text-muted">{t('hq.scorecard.scoreNote')}</p>

      {ranked.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.scorecard.empty')}</p>
      ) : (
        <Card className="flex flex-col gap-4 p-5">
          {ranked.map((r, i) => (
            <div key={r.depotId} className="flex flex-col gap-1">
              <RankBar
                position={i}
                label={r.name}
                score={r.score}
                caption={`${t('hq.scorecard.orders')}: ${r.orderCount} · SLA ${Math.round(r.sla * 100)}%`}
              />
              <div className="pl-9 text-xs text-muted">
                {t('hq.scorecard.revenue')}: <Money amount={r.revenue} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
