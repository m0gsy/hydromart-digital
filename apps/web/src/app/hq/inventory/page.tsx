'use client';

import Link from 'next/link';
import { Package, Warning } from '@phosphor-icons/react';

import { StockBar } from '@/components/hq/charts';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, InventoryItem, Page } from '@/lib/types';

interface DepotStock {
  depot: DepotAdmin;
  total: number;
  low: number;
}

// Design 16a — network stock health. Loops the depot directory, then fans out one
// inventory.lines call per depot (all real). "Restok" links to the depot detail.
export default function HqInventoryPage() {
  const { t } = useT();

  const data = useAsync<DepotStock[]>(async () => {
    const list = await api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true);
    const depots = list.items.filter((d) => d.active);
    return Promise.all(
      depots.map(async (depot) => {
        const lines = await api.get<InventoryItem[]>(endpoints.inventory.lines(depot.id), true);
        return { depot, total: lines.length, low: lines.filter((l) => l.lowStock).length };
      }),
    );
  });

  const rows = data.data ?? [];
  const critical = rows.filter((r) => r.low > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.inventory.title')}</h1>
            <p className="text-sm text-muted">{t('hq.inventory.subtitle')}</p>
          </div>
        </div>
        {critical > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--warning-bg)] px-3 py-1.5 text-xs font-bold text-[color:var(--warning)]">
            <Warning size={14} weight="fill" />
            {t('hq.inventory.critical', { n: critical })}
          </span>
        ) : rows.length > 0 ? (
          <span className="rounded-full bg-[color:var(--success-bg)] px-3 py-1.5 text-xs font-bold text-[color:var(--success)]">
            {t('hq.inventory.allHealthy')}
          </span>
        ) : null}
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.inventory.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const healthy = Math.max(0, r.total - r.low);
            return (
              <Card key={r.depot.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.depot.name}</p>
                    <p className="text-xs text-muted">
                      {r.depot.code} · {t('hq.inventory.lines', { n: r.total })}
                      {r.low > 0 && (
                        <span className="text-[color:var(--warning)]">
                          {' · '}
                          {t('hq.inventory.low', { n: r.low })}
                        </span>
                      )}
                    </p>
                  </div>
                  <Link
                    href={`/hq/depots/${r.depot.id}`}
                    className="shrink-0 rounded-lg border border-app px-3 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                  >
                    {t('hq.inventory.restock')}
                  </Link>
                </div>
                <StockBar
                  label={t('hq.inventory.lines', { n: r.total })}
                  value={healthy}
                  max={Math.max(1, r.total)}
                  low={r.low > 0}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
