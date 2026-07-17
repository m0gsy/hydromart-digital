'use client';

import { Recycle } from '@phosphor-icons/react';

import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, GallonIssueSummary, GallonReturnSummary, Page } from '@/lib/types';

interface ReturnRow {
  depot: DepotAdmin;
  circulating: number;
  deposit: number;
}

// Design 16b — empty-gallon returns network-wide. Per depot: outstanding gallons
// (issued − returned) and deposit still held (issue deposit − refunded). All real.
export default function HqReturnsPage() {
  const { t } = useT();

  const data = useAsync<ReturnRow[]>(async () => {
    const list = await api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true);
    const depots = list.items.filter((d) => d.active);
    return Promise.all(
      depots.map(async (depot) => {
        const [ret, iss] = await Promise.all([
          api.get<GallonReturnSummary>(endpoints.returns.summary(depot.id), true),
          api.get<GallonIssueSummary>(endpoints.gallonIssues.summary(depot.id), true),
        ]);
        return {
          depot,
          circulating: Math.max(0, iss.gallons - ret.gallons),
          deposit: Math.max(0, iss.depositHeld - ret.depositRefunded),
        };
      }),
    );
  });

  const rows = data.data ?? [];
  const totalCirculating = rows.reduce((n, r) => n + r.circulating, 0);
  const totalDeposit = rows.reduce((n, r) => n + r.deposit, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Recycle size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.returns.title')}</h1>
          <p className="text-sm text-muted">{t('hq.returns.subtitle')}</p>
        </div>
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.returns.empty')}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('hq.returns.totalCirculating')}
              </p>
              <p className="text-2xl font-bold tabular-nums">{totalCirculating}</p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('hq.returns.totalDeposit')}
              </p>
              <Money amount={totalDeposit} className="text-2xl font-bold" />
            </Card>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[440px] text-sm">
              <thead>
                <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">{t('hq.returns.depot')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('hq.returns.circulating')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('hq.returns.deposit')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('hq.returns.outstanding')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.map((r) => (
                  <tr key={r.depot.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{r.depot.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted">{r.depot.code}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.circulating}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <Money amount={r.deposit} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{r.circulating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
