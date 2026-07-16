'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { MagnifyingGlass, Storefront } from '@phosphor-icons/react';

import { DepotForm } from '@/components/hq/depot-form';
import { Badge, Button, Card, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page } from '@/lib/types';

// Design 3a — network depot directory. Search filters client-side; the row opens the
// depot detail drill-down; onboard opens the shared DepotForm.
export default function HqDepotsPage() {
  const { t } = useT();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const list = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const items = list.data?.items ?? [];

  const filtered = useMemo(() => {
    const source = list.data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((d) =>
      [d.name, d.code, d.city, d.province].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [list.data, query]);

  function closeForm() {
    setCreating(false);
    list.reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Storefront size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.depots.title')}</h1>
            <p className="text-sm text-muted">{t('hq.depots.subtitle')}</p>
          </div>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}>＋ {t('hq.depots.onboard')}</Button>}
      </div>

      {creating && <DepotForm depot={null} onDone={closeForm} onCancel={() => setCreating(false)} />}

      <div className="relative">
        <MagnifyingGlass
          size={18}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('hq.depots.search')}
          className="pl-10"
          aria-label={t('hq.depots.search')}
        />
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('hq.depots.emptyAll')} icon={<Storefront size={40} weight="fill" />} />
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{t('hq.depots.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => router.push(`/hq/depots/${d.id}`)}
              className="text-left"
            >
              <Card className="flex h-full flex-col gap-2 p-4 transition-shadow hover:shadow-lift">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="truncate text-xs text-muted">
                      {d.code} · {d.city} · {d.province}
                    </p>
                  </div>
                  <Badge tone={d.active ? 'success' : 'neutral'}>
                    {d.active ? t('hq.depots.status.active') : t('hq.depots.status.suspended')}
                  </Badge>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs">
                  <Badge tone={d.ownershipType === 'WARALABA' ? 'warning' : 'brand'}>
                    {d.ownershipType === 'WARALABA'
                      ? t('hq.depots.ownership.franchise')
                      : t('hq.depots.ownership.central')}
                  </Badge>
                  <span className="tabular-nums text-muted">
                    {t('hq.depots.radiusKm', { n: d.serviceRadiusKm })}
                  </span>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
