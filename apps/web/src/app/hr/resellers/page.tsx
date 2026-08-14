'use client';

import { Storefront } from '@phosphor-icons/react';
import { useT } from '@/lib/locale-context';

import { HrDepotPicker } from '@/components/hr/depot-picker';
import { RemoteImage } from '@/components/remote-image';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, mediaUrl } from '@/lib/format';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { Reseller } from '@/lib/reseller';

/**
 * Read-only reseller ("agen") roster inside the HR console. Same registry the depot
 * console writes to — HR holds `resellerView` only, so nothing here edits a discount.
 */
export default function HrResellersPage() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();

  const rows = useAsync<Reseller[]>(
    () => api.get(endpoints.resellers.list(scopedId ? { depotId: scopedId } : {}), true),
    [scopedId],
  );

  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Storefront size={24} weight="fill" className="text-brand-500" />
            Reseller / Agen
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Hanya lihat. Registry yang sama dengan konsol depot.
            {depot && (
              <>
                {' '}
                Depot: <strong className="text-[color:var(--text)]">{depot.name}</strong>
              </>
            )}
          </p>
        </div>
        <HrDepotPicker />
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('hrFix.hrResellers.noDepot')} icon={<Storefront size={40} weight="fill" />} />
      ) : rows.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.reload} />
      ) : (rows.data ?? []).length === 0 ? (
        <CenterState title={t('hrFix.hrResellers.empty')} icon={<Storefront size={40} weight="fill" />} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[12.5px] text-muted">
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrResellers.photo')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrResellers.customer')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrResellers.discount')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrResellers.monthlyTarget')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrResellers.joined')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrResellers.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.customerId} className="border-t border-app">
                  <td className="px-4 py-2.5">
                    <RemoteImage
                      src={mediaUrl(r.photoUrl)}
                      alt={`Foto agen ${r.customerName ?? r.customerId}`}
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-lg object-cover"
                      fallback={<span className="text-xs text-muted">—</span>}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {r.customerName ?? (
                      <span className="font-mono text-xs text-muted">
                        {r.customerId.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {r.flatGallonPriceIdr > 0
                      ? t('hrFix.resellers.perGallon', { amount: r.flatGallonPriceIdr.toLocaleString('id-ID') })
                      : `${r.discountPct}%`}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{r.monthlyTargetQty}</td>
                  <td className="px-4 py-2.5 text-muted">{formatDateTime(r.joinDate)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={r.active ? 'success' : 'neutral'}>
                      {r.active ? t('hrFix.hrResellers.active') : t('hrFix.hrResellers.inactive')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
