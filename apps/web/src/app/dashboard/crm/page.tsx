'use client';

import { ChartPieSlice, Lock, UsersThree, WhatsappLogo } from '@phosphor-icons/react';

import { ExternalLink } from '@/components/external-link';
import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canViewDepotCrm } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CrmDashboard, CrmFollowUp } from '@/lib/types';

/** wa.me deep link (manual send — no gateway). Strips non-digits; 08xx → 62xx (Indonesia). */
function waLink(phone: string, text: string): string {
  let n = phone.replace(/\D/g, '');
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

function SegmentStat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </Card>
  );
}

function FollowUpRow({ f }: { f: CrmFollowUp }) {
  const { t } = useT();
  const name = f.name ?? t('dashA.crm.noName');
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-semibold">{name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span>{f.phone ?? t('dashA.crm.noPhone')}</span>
          {f.daysSinceLastOrder != null && <span>{t('dashA.crm.daysAgo', { n: f.daysSinceLastOrder })}</span>}
          <span>{t('dashA.crm.orders', { n: f.orderCount })}</span>
          <span className="tabular-nums">{formatIDR(f.totalSpentIdr)}</span>
        </span>
      </span>
      {f.phone ? (
        <ExternalLink
          href={waLink(f.phone, t('dashA.crm.waTemplate', { name }))}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
        >
          <WhatsappLogo size={16} weight="fill" />
          {t('dashA.crm.wa')}
        </ExternalLink>
      ) : (
        <span className="shrink-0 text-xs text-muted">{t('dashA.crm.noPhone')}</span>
      )}
    </li>
  );
}

function CrmBody() {
  const { t } = useT();
  const { scopedId, selected, depots } = useDepot();

  const { data, error, loading, reload } = useAsync<CrmDashboard | null>(
    () => (scopedId ? api.get(endpoints.depotCrm.crmDashboard(scopedId), true) : Promise.resolve(null)),
    [scopedId],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <ChartPieSlice size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashA.crm.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('dashA.crm.subtitle')}</p>
        {scopedDepot && (
          <p className="mt-1 text-[12.5px] text-muted">
            <strong className="text-[color:var(--text)]">
              {scopedDepot.name} · {scopedDepot.code}
            </strong>
          </p>
        )}
      </div>

      {!scopedId ? (
        <CenterState title={t('dashA.crm.title')} icon={<UsersThree size={40} weight="fill" />}>
          {t('dashA.crm.selectDepot')}
        </CenterState>
      ) : loading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SegmentStat label={t('dashA.crm.baru')} value={data.counts.baru} hint={t('dashA.crm.baruHint')} tone="text-brand-600" />
            <SegmentStat label={t('dashA.crm.aktif')} value={data.counts.aktif} hint={t('dashA.crm.aktifHint')} tone="text-green-600" />
            <SegmentStat label={t('dashA.crm.inactive')} value={data.counts.inactive} hint={t('dashA.crm.inactiveHint')} tone="text-amber-600" />
            <SegmentStat label={t('dashA.crm.total')} value={data.counts.total} hint="" tone="" />
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('dashA.crm.repeatRate')}</p>
              <p className="text-2xl font-bold tabular-nums">{data.repeatRatePct}%</p>
            </Card>
          </div>

          <Card className="flex flex-col p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <WhatsappLogo size={18} weight="fill" className="text-[#25D366]" />
              {t('dashA.crm.followTitle')}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{t('dashA.crm.followSub')}</p>
            {data.followUps.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{t('dashA.crm.followEmpty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-[color:var(--border)]">
                {data.followUps.map((f) => (
                  <FollowUpRow key={f.customerId} f={f} />
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
  if (!canViewDepotCrm(customer?.role)) {
    return (
      <CenterState title={t('dashA.crm.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.crm.gateBody')}
      </CenterState>
    );
  }
  return <CrmBody />;
}

export default function CrmPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
