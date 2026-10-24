'use client';

import { DonutChart } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type {
  ChurnCustomer,
  CrmDashboard,
  DepotLoyaltySummary,
  DepotRatingsReport,
  DepotReferralSummary,
  SubscriptionNetworkSummary,
  VoucherBurnSummary,
} from '@/lib/types';

const dash = '—';

/** "Budi Santoso" -> "B. S.": a review is read for what it says, not for who wrote it. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.length === 0 ? '' : parts.map((p) => `${[...p][0]?.toUpperCase() ?? ''}.`).join(' ');
}

function Stars({ value }: { value: number }) {
  const { t } = useT();
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      role="img"
      aria-label={t('insight.customers.stars', { n: full })}
      className="whitespace-nowrap"
    >
      <span aria-hidden="true">{'★'.repeat(full)}</span>
      <span aria-hidden="true" className="text-muted">
        {'★'.repeat(5 - full)}
      </span>
    </span>
  );
}

/** Pelanggan: who the customers are, whether they stay, and what keeps them. */
export function CustomersTab({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, range, depotIds, depotId } = ctx;
  const mayCrm = can('depotCrm', role);
  const mayLoyalty = can('loyaltyRead', role);
  const mayVoucher = can('voucherRead', role);
  const mayChurn = can('churn', role);
  const maySubs = can('hqBackOffice', role);
  const mayReviews = can('orderReports', role);
  const needsDepot = (mayCrm || mayLoyalty || mayReviews) && depotId == null;

  const crm = useInsightData(
    () => api.get<CrmDashboard>(endpoints.depotCrm.crmDashboard(depotId as string), true),
    [depotId],
    mayCrm && depotId != null,
  );
  const loyalty = useInsightData(
    () => api.get<DepotLoyaltySummary>(endpoints.loyalty.depotSummary(depotId as string), true),
    [depotId],
    mayLoyalty && depotId != null,
  );
  const referral = useInsightData(
    () => api.get<DepotReferralSummary>(endpoints.referrals.depotSummary(depotId as string), true),
    [depotId],
    mayLoyalty && depotId != null,
  );
  const churn = useInsightData(
    () =>
      api.get<{ customers: ChurnCustomer[] }>(
        endpoints.forecast.churn({ depotId: depotIds?.[0], limit: 100, days: 90 }),
        true,
      ),
    [depotIds?.join(',')],
    mayChurn,
  );
  const burn = useInsightData(
    () => api.get<VoucherBurnSummary>(endpoints.vouchers.burnSummary, true),
    [],
    mayVoucher,
  );
  const subs = useInsightData(
    () => api.get<SubscriptionNetworkSummary>(endpoints.subscriptions.adminSummary, true),
    [],
    maySubs,
  );
  const reviews = useInsightData(
    () =>
      api.get<DepotRatingsReport>(
        endpoints.reports.depotRatings(depotId as string, { from: range.from, to: range.to }),
        true,
      ),
    [depotId, range.from, range.to],
    mayReviews && depotId != null,
  );

  const bands = (['HIGH', 'MEDIUM', 'LOW'] as const).map((band) => ({
    band,
    count: (churn.data?.customers ?? []).filter((c) => c.riskBand === band).length,
  }));
  const tiers = loyalty.data?.tiers;

  return (
    <div className="flex flex-col gap-6">
      {needsDepot && <p className="text-xs text-muted">{t('insight.customers.needDepot')}</p>}

      {(mayCrm || mayVoucher || maySubs) && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mayCrm && depotId != null && !crm.forbidden && (
            <>
              <KpiCard
                label={t('insight.customers.total')}
                value={crm.data ? String(crm.data.counts.total) : dash}
                definition={t('insight.customers.totalDef')}
              />
              <KpiCard
                label={t('insight.customers.fresh')}
                value={crm.data ? String(crm.data.counts.baru) : dash}
                definition={t('insight.customers.freshDef')}
              />
              <KpiCard
                label={t('insight.customers.inactive')}
                value={crm.data ? String(crm.data.counts.inactive) : dash}
                definition={t('insight.customers.inactiveDef')}
              />
              <KpiCard
                label={t('insight.customers.repeat')}
                value={crm.data ? `${Math.round(crm.data.repeatRatePct)}%` : dash}
                definition={t('insight.customers.repeatDef')}
              />
            </>
          )}
          {mayVoucher && !burn.forbidden && (
            <KpiCard
              label={t('insight.customers.voucherBurn')}
              value={burn.data ? formatIDR(burn.data.totalUsed) : dash}
              hint={t('insight.customers.sinceStart')}
              definition={t('insight.customers.voucherBurnDef')}
            />
          )}
          {maySubs && !subs.forbidden && (
            <KpiCard
              label={t('insight.customers.subscriptions')}
              value={subs.data ? String(subs.data.activeSubscriptions) : dash}
              hint={
                subs.data
                  ? t('insight.customers.subscribers', { n: subs.data.activeSubscribers })
                  : undefined
              }
              definition={t('insight.customers.subscriptionsDef')}
            />
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mayLoyalty && depotId != null && (
          <WidgetCard
            title={t('insight.customers.loyaltyTitle')}
            source={loyalty}
            isEmpty={(d) => d.totalMembers === 0}
            emptyText={t('insight.customers.loyaltyEmpty')}
            detailHref="/dashboard/loyalty"
          >
            {(d) => (
              <div className="flex flex-col gap-3">
                <dl className="m-0 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-[11px] text-muted">{t('insight.customers.members')}</dt>
                    <dd className="m-0 text-lg font-bold tabular-nums">{d.totalMembers}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">{t('insight.customers.points')}</dt>
                    <dd className="m-0 text-lg font-bold tabular-nums">{d.pointsOutstanding}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">{t('insight.customers.redeemed')}</dt>
                    <dd className="m-0 text-lg font-bold tabular-nums">{d.redeemedThisMonth}</dd>
                  </div>
                </dl>
                {tiers && (
                  <DonutChart
                    segments={Object.entries(tiers).map(([tier, value]) => ({
                      label: tier,
                      value,
                    }))}
                    total={t('insight.customers.members')}
                    ariaLabel={t('insight.customers.tiersAria')}
                  />
                )}
              </div>
            )}
          </WidgetCard>
        )}

        {mayLoyalty && depotId != null && (
          <WidgetCard
            title={t('insight.customers.referralTitle')}
            source={referral}
            isEmpty={(d) => d.invited === 0}
            emptyText={t('insight.customers.referralEmpty')}
            detailHref="/dashboard/referral"
          >
            {(d) => (
              <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-muted">{t('insight.customers.invited')}</dt>
                  <dd className="m-0 text-lg font-bold tabular-nums">{d.invited}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted">{t('insight.customers.qualified')}</dt>
                  <dd className="m-0 text-lg font-bold tabular-nums">{d.qualified}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted">{t('insight.customers.conversion')}</dt>
                  <dd className="m-0 text-lg font-bold tabular-nums">
                    {Math.round(d.conversionPct)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted">{t('insight.customers.pointsGiven')}</dt>
                  <dd className="m-0 text-lg font-bold tabular-nums">{d.pointsAwarded}</dd>
                </div>
              </dl>
            )}
          </WidgetCard>
        )}

        {mayChurn && (
          <WidgetCard
            title={t('insight.customers.churnTitle')}
            source={churn}
            isEmpty={(d) => d.customers.length === 0}
            emptyText={t('insight.customers.churnEmpty')}
            detailHref="/hq/churn"
          >
            {(d) => (
              <div className="flex flex-col gap-2">
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                  {bands.map((b) => (
                    <li key={b.band} className="flex justify-between gap-2">
                      <span>{t(`insight.customers.risk.${b.band}`)}</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          b.band === 'HIGH' && b.count > 0 ? 'text-[color:var(--danger)]' : ''
                        }`}
                      >
                        {b.count}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted">
                  {t('insight.customers.churnNote', { n: d.customers.length })}
                </p>
              </div>
            )}
          </WidgetCard>
        )}

        {mayReviews && depotId != null && (
          <WidgetCard
            title={t('insight.customers.reviewsTitle')}
            source={reviews}
            isEmpty={(d) => d.count === 0}
            emptyText={t('insight.customers.reviewsEmpty')}
            detailHref="/dashboard/ratings"
          >
            {(d) => (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  <span className="text-xl font-bold tabular-nums">
                    {d.average != null ? d.average.toFixed(2).replace('.', ',') : dash}
                  </span>{' '}
                  <span className="text-xs text-muted">
                    {t('insight.kpi.reviews', { count: d.count })}
                  </span>
                </p>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {d.recent.slice(0, 5).map((r, i) => (
                    <li key={`${r.createdAt}-${i}`} className="flex flex-col gap-0.5 text-sm">
                      <span className="flex items-center gap-2 text-xs">
                        <Stars value={r.stars} />
                        <span className="text-muted">{initials(r.customerName)}</span>
                      </span>
                      {r.comment && <span>{r.comment}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </WidgetCard>
        )}
      </div>
    </div>
  );
}
