'use client';

import { useMemo } from 'react';
import { Trophy } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { RankBar } from '@/components/hq/charts';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { fetchSettingsSchema, type SettingsSchema } from '@/lib/settings';
import { useAsync } from '@/lib/use-async';
import type { NetworkDashboard } from '@/lib/types';

function range30(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Design 22c — depot scorecard. Composite = revenue and SLA, both real from the network
// roll-up (order-service revenue + delivery-service per-depot SLA), weighted by
// `scorecardRevenueWeightPct` from payout's settings. The weights used to be `0.7` and
// `0.3` written here — two literals deciding where each franchisee sits in a league table,
// changeable only by a deploy. One setting now, GLOBAL, and the SLA half is the remainder
// so the pair can never stop summing to 100.
export default function HqScorecardPage() {
  const { t } = useT();
  const range = useMemo(range30, []);
  const dash = useAsync<NetworkDashboard>(() => api.get(endpoints.hq.rollup(range), true));
  // No depot id: the weighting is head office's, and the setting is global-only.
  const settings = useAsync<SettingsSchema>(() => fetchSettingsSchema('/payout/api/v1', null), []);

  if (dash.loading || settings.loading) return <Skeleton className="h-96 w-full" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;
  if (settings.error) return <ErrorState message={settings.error} onRetry={settings.reload} />;

  const items = dash.data?.depots ?? [];
  const maxRevenue = Math.max(1, ...items.map((d) => d.revenue ?? 0));
  const revenueWeight = Number(settings.data?.effective?.scorecardRevenueWeightPct ?? 70) / 100;
  const slaWeight = 1 - revenueWeight;

  const ranked = items
    .map((d) => {
      /*
       * E-3 fixed this for REVENUE and left the same mistake standing on SLA.
       *
       * A depot whose revenue never came back (outside the report's top-N) is scored on SLA
       * alone, rescaled to the full 100, rather than counted as having earned Rp 0 —
       * weighting an unknown as the worst possible number put depots at the bottom of a
       * league table for a limit in the report.
       *
       * CA-2-66: `d.slaRate ?? 0` did exactly that, in the other direction. `slaRate` is
       * null when a depot delivered nothing in range — and also for EVERY depot when
       * delivery-service could not be read at all, which is the case the card names. Both
       * were scored as 0% on-time and captioned "SLA 0%", which is not an absence of data,
       * it is an accusation.
       *
       * So: an unknown half never contributes, and the half that IS known is rescaled to
       * the full 100. A depot with neither scores 0 because there is nothing to score, and
       * the caption says so rather than inventing a percentage.
       */
      const sla = d.slaRate;
      const hasRevenue = d.revenue != null;
      const hasSla = sla != null;
      const weight = (hasRevenue ? revenueWeight : 0) + (hasSla ? slaWeight : 0);
      const raw =
        (hasRevenue ? (d.revenue! / maxRevenue) * revenueWeight : 0) +
        (hasSla ? sla! * slaWeight : 0);
      // `weight` is 0 only when both halves are unknown; dividing by it would be NaN, and a
      // NaN sorts unpredictably through a league table.
      const score = weight > 0 ? raw / weight : 0;
      return {
        depotId: d.depotId,
        name: d.name,
        revenue: d.revenue,
        orderCount: d.orderCount,
        sla,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Trophy}
        title={t('hq.scorecard.title')}
        subtitle={t('hq.scorecard.subtitle')}
      />

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
                caption={`${t('hq.scorecard.orders')}: ${r.orderCount ?? t('hq.common.dash')} · SLA ${
                  r.sla != null ? `${Math.round(r.sla * 100)}%` : t('hq.common.dash')
                }`}
              />
              <div className="pl-9 text-xs text-muted">
                {t('hq.scorecard.revenue')}:{' '}
                {r.revenue != null ? <Money amount={r.revenue} /> : t('hq.common.dash')}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
