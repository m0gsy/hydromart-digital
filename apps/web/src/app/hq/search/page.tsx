'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MagnifyingGlass, Receipt, Storefront, UserGear } from '@phosphor-icons/react';

import { Card, Input, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { Customer, DepotAdmin, Order, Page } from '@/lib/types';

interface Results {
  depots: DepotAdmin[];
  staff: Customer[];
  orders: Order[];
}

const EMPTY: Results = { depots: [], staff: [], orders: [] };

// Design 20b — global search. There is no dedicated /search endpoint in Milestone A,
// so results are assembled client-side from existing list endpoints: depots.manage has
// a server `search`, staff + orders are fetched recent and filtered by the query.
export default function HqSearchPage() {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);

  // Debounce input.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const q = debounced.toLowerCase();
    if (!q) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all([
      api
        .get<Page<DepotAdmin>>(endpoints.depots.manage({ search: debounced, limit: 10 }), true)
        .then((p) => p.items)
        .catch(() => [] as DepotAdmin[]),
      api
        .get<Page<Customer>>(endpoints.auth.staff({ limit: 100 }), true)
        .then((p) =>
          p.items.filter((s) =>
            [s.fullName, s.phone, s.role].some((v) => v?.toLowerCase().includes(q)),
          ),
        )
        .catch(() => [] as Customer[]),
      api
        .get<Page<Order>>(endpoints.orders.manage({ limit: 20 }), true)
        .then((p) => p.items.filter((o) => o.orderNumber.toLowerCase().includes(q)))
        .catch(() => [] as Order[]),
    ]).then(([depots, staff, orders]) => {
      if (!alive) return;
      setResults({ depots, staff: staff.slice(0, 10), orders: orders.slice(0, 10) });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [debounced]);

  const total = results.depots.length + results.staff.length + results.orders.length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('hq.search.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('hq.search.subtitle')}</p>
      </div>

      <div className="relative">
        <MagnifyingGlass
          size={18}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('hq.search.placeholder')}
          className="pl-10"
          autoFocus
          aria-label={t('hq.search.placeholder')}
        />
      </div>

      {!debounced ? (
        <p className="py-12 text-center text-sm text-muted">{t('hq.search.empty')}</p>
      ) : loading ? (
        <div className="flex justify-center py-12 text-brand-500">
          <Spinner size={26} />
        </div>
      ) : total === 0 ? (
        <p className="py-12 text-center text-sm text-muted">{t('hq.search.noResults', { q: debounced })}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {results.depots.length > 0 && (
            <Group icon={<Storefront size={16} weight="fill" />} title={t('hq.search.groups.depots')}>
              {results.depots.map((d) => (
                <Link key={d.id} href={`/hq/depots/${d.id}`} className="block">
                  <ResultRow title={d.name} meta={`${d.code} · ${d.city}`} />
                </Link>
              ))}
            </Group>
          )}
          {results.staff.length > 0 && (
            <Group icon={<UserGear size={16} weight="fill" />} title={t('hq.search.groups.staff')}>
              {results.staff.map((s) => (
                <Link key={s.id} href="/hq/staff" className="block">
                  <ResultRow
                    title={s.fullName || s.phone}
                    meta={`${s.phone} · ${t(`hq.roles.${s.role}`)}`}
                  />
                </Link>
              ))}
            </Group>
          )}
          {results.orders.length > 0 && (
            <Group icon={<Receipt size={16} weight="fill" />} title={t('hq.search.groups.orders')}>
              {results.orders.map((o) => (
                <ResultRow key={o.id} title={o.orderNumber} meta={o.status} />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-muted">
        <span className="text-brand-500">{icon}</span>
        {title}
      </p>
      <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">{children}</Card>
    </div>
  );
}

function ResultRow({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-soft)]">
      <span className="min-w-0 truncate font-medium">{title}</span>
      <span className="shrink-0 truncate text-xs text-muted">{meta}</span>
    </div>
  );
}
