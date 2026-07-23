'use client';

import { Gift, Lock, ShareNetwork } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotReferralSummary } from '@/lib/types';

// referral-service has no customer names — top referrers show a short id + points.
function shortId(id: string) {
  return id.slice(0, 6).toUpperCase();
}

function ReferralBody() {
  const { t } = useT();
  const { scopedId } = useDepot();
  const summary = useAsync<DepotReferralSummary | null>(
    () => (scopedId ? api.get(endpoints.referrals.depotSummary(scopedId), true) : Promise.resolve(null)),
    [scopedId],
  );
  const s = summary.data;
  const stats = [
    { label: t('dashC.referral.invited'), value: (s?.invited ?? 0).toLocaleString('id-ID') },
    { label: t('dashC.referral.qualified'), value: (s?.qualified ?? 0).toLocaleString('id-ID') },
    { label: t('dashC.referral.conversion'), value: `${s?.conversionPct ?? 0}%` },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShareNetwork size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashC.referral.heading')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{t('dashC.referral.subtitle')}</p>
          </div>
        </div>
        <Chip tone="success">{t('dashC.referral.active')}</Chip>
      </div>

      <Card className="flex items-center gap-3 bg-brand-800 p-5" elevated={false}>
        <Gift size={26} weight="fill" className="shrink-0 text-on-brand" />
        <div className="text-on-brand">
          <p className="font-semibold">{t('dashC.referral.perkTitle')}</p>
          <p className="text-[12.5px] opacity-80">{t('dashC.referral.perkBody')}</p>
        </div>
      </Card>

      {summary.loading ? (
        <Skeleton className="h-56 w-full" />
      ) : summary.error ? (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((st) => (
              <Card key={st.label} className="flex flex-col gap-1 p-4">
                <span className="text-xs text-[color:var(--text-muted)]">{st.label}</span>
                <span className="text-2xl font-bold tabular-nums">{st.value}</span>
              </Card>
            ))}
          </div>

          <Card className="flex flex-col gap-1 p-5">
            <h2 className="mb-2 font-semibold">{t('dashC.referral.topTitle')}</h2>
            {(s?.topReferrers ?? []).length === 0 ? (
              <p className="py-3 text-sm text-[color:var(--text-muted)]">
                {t('dashC.referral.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-[color:var(--border)]">
                {(s?.topReferrers ?? []).map((r) => (
                  <li key={r.customerId} className="flex items-center gap-3 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                      {shortId(r.customerId).slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{t('dashC.referral.customer', { id: shortId(r.customerId) })}</p>
                      <p className="text-xs text-[color:var(--text-muted)]">{t('dashC.referral.friendsJoined', { n: r.referralCount })}</p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums text-[color:var(--success)]">
                      {t('dashC.referral.pointsValue', { n: r.pointsEarned.toLocaleString('id-ID') })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title={t('dashC.referral.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.referral.gateBody')}
      </CenterState>
    );
  }
  return <ReferralBody />;
}

export default function ReferralPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
