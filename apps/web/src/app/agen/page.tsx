'use client';

import { ArrowsClockwise, Bell, Storefront, Tag } from '@phosphor-icons/react';
import Link from 'next/link';

import { RequireAuth } from '@/components/require-auth';
import { CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

type ResellerMe = {
  active: boolean;
  discountPct: number;
  flatGallonPriceIdr: number;
  homeDepotId: string;
};

type DepotLite = { id: string; name: string; code: string };

/**
 * K4.1 — the agen's own status screen.
 *
 * There was nothing on the agen side at all: no self-registration, no status screen, no
 * notifications. The notifications half turned out to exist already (customer-service
 * sends RESELLER_PRICE_CHANGED / RESELLER_DEACTIVATED through crm), so what was actually
 * missing was a place to answer "am I still an agen, and at what price" — the only trace
 * before this was a badge on checkout, which disappeared exactly when the read failed,
 * i.e. exactly when the price was about to be wrong.
 *
 * `/resellers/me` is read here for DISPLAY only. A4 removed the web's previous caller on
 * purpose: checkout used it to re-derive the agen rule in the browser, a third copy of a
 * pricing decision that belongs to order-service. Showing someone their own terms is not
 * that — nothing on this screen feeds a price, and no total is computed from it.
 */
function Status() {
  const { t } = useT();
  const me = useAsync<ResellerMe | null>(async () => {
    try {
      return await api.get<ResellerMe>(endpoints.resellers.me, true);
    } catch (err) {
      // 404 is the ordinary answer for "not an agen", not a failure. Anything else is.
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  });

  // Only to put a name on the home depot; the id alone is not something to show a person.
  // Public list, so it works for any signed-in customer.
  const depots = useAsync<{ items: DepotLite[] }>(() => api.getCached(endpoints.depots.browse({})));

  if (me.loading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (me.error) return <ErrorState message={t('agen.loadError')} onRetry={me.reload} />;

  if (me.data == null) {
    return (
      <CenterState icon={<Tag size={40} weight="duotone" />} title={t('agen.notAgentTitle')}>
        {t('agen.notAgentBody')}
      </CenterState>
    );
  }

  const row = me.data;
  const depot = depots.data?.items.find((d) => d.id === row.homeDepotId);

  return (
    <div className="flex flex-col gap-3">
      <div className={`rounded-2xl border p-4 ${row.active ? 'border-app surface' : 'border-[color:var(--danger)] bg-[color:var(--danger-bg)]'}`}>
        <h2 className="text-[15px] font-extrabold">
          {row.active ? t('agen.activeTitle') : t('agen.inactiveTitle')}
        </h2>
        {!row.active && <p className="mt-1 text-[12.5px] leading-snug text-muted">{t('agen.inactiveBody')}</p>}

        {row.active && (
          <dl className="mt-3 flex flex-col gap-2.5">
            {/* A flat gallon price and a percentage are alternatives, not a pair: the row
                carries whichever one the depot set. Showing a zero would read as "free". */}
            {row.flatGallonPriceIdr > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[12.5px] text-muted">{t('agen.flatLabel')}</dt>
                <dd className="text-[15px] font-extrabold tabular-nums">{formatIDR(row.flatGallonPriceIdr)}</dd>
              </div>
            )}
            {row.flatGallonPriceIdr <= 0 && row.discountPct > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[12.5px] text-muted">{t('agen.discountLabel')}</dt>
                <dd className="text-[15px] font-extrabold tabular-nums">{row.discountPct}%</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="rounded-2xl border border-app surface p-4">
        <div className="flex items-center gap-2">
          <Storefront size={17} weight="fill" className="text-brand-600" />
          <span className="text-[13px] font-extrabold">{t('agen.depotLabel')}</span>
        </div>
        <p className="mt-1.5 text-[14px] font-bold">
          {depot ? `${depot.name} (${depot.code})` : t('agen.depotUnknown')}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-muted">{t('agen.depotNote')}</p>
      </div>

      <Link
        href="/notifications"
        className="flex items-start gap-2.5 rounded-2xl border border-app surface p-4 transition-colors hover:bg-brand-50"
      >
        <Bell size={17} weight="fill" className="mt-0.5 flex-shrink-0 text-brand-600" />
        <span>
          <span className="block text-[13px] font-extrabold">{t('agen.changesTitle')}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t('agen.changesBody')}</span>
        </span>
        <ArrowsClockwise size={15} className="ml-auto mt-0.5 flex-shrink-0 text-muted" />
      </Link>
    </div>
  );
}

export default function AgenPage() {
  const { t } = useT();
  return (
    <RequireAuth>
      <div className="mx-auto max-w-[430px]">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{t('agen.title')}</h1>
        <p className="mt-1 text-[13px] text-muted">{t('agen.subtitle')}</p>
        <div className="mt-4">
          <Status />
        </div>
      </div>
    </RequireAuth>
  );
}
