'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MagnifyingGlass, Receipt, Storefront, User, UserGear } from '@phosphor-icons/react';

import { Card, Input, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { Customer, DepotAdmin, Order } from '@/lib/types';

interface Results {
  depots: DepotAdmin[];
  staff: Customer[];
  orders: Order[];
  /*
   * CA-2-61: head office's global search could not find a CUSTOMER.
   *
   * Depots, staff and orders — every object the network runs on except the people it
   * runs for. `/hq/customers` is a phone lookup and nothing else, so a customer's number
   * typed into the one box labelled "search" returned "tidak ada hasil" while the depot
   * console, searching the same account through the same endpoint, found them.
   *
   * By phone only, and deliberately: `customerLookup` is the only customer read head
   * office has, there is no search-by-name endpoint behind it, and inventing one here
   * would mean a new backend route for a box that already has a working answer.
   */
  customer: Customer | null;
}

const EMPTY: Results = { depots: [], staff: [], orders: [], customer: null };

/** Enough of a phone number to be worth a lookup — the same test the depot search uses. */
const PHONE_RE = /^\+?\d[\d\s-]{6,}$/;

// Design 20b — global search. There is still no dedicated /search endpoint, so results
// are assembled from the three existing list endpoints — but all three now MATCH on the
// server.
//
// Audit F-12: this used to fetch 100 staff rows and 20 recent orders per keystroke and
// filter them in JavaScript, which made it both expensive and wrong: a staff member on
// page 2 of the directory, or an order older than the last twenty, was unfindable. Each
// list takes the term as a query parameter now and returns at most ten rows.
export default function HqSearchPage() {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  /** Sources that could not be reached this search — see the note in the effect. */
  const [unreachable, setUnreachable] = useState<('depots' | 'staff' | 'orders' | 'customers')[]>(
    [],
  );

  // Debounce input.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    /*
     * Each source is caught so one outage does not blank the whole page — but the failure
     * is now REMEMBERED. Catching to `[]` and saying nothing turned "we could not search
     * staff" into "no staff matched", and a search that answers "nothing found" is the one
     * nobody searches twice.
     */
    const failures: ('depots' | 'staff' | 'orders' | 'customers')[] = [];
    const source = <T,>(
      label: 'depots' | 'staff' | 'orders' | 'customers',
      p: Promise<{ items: T[] }>,
    ): Promise<T[]> =>
      p
        .then((r) => r.items)
        .catch(() => {
          failures.push(label);
          return [] as T[];
        });

    Promise.all([
      source<DepotAdmin>(
        'depots',
        api.get(endpoints.depots.manage({ search: debounced, limit: 10 }), true),
      ),
      source<Customer>(
        'staff',
        api.get(endpoints.auth.staff({ search: debounced, limit: 10 }), true),
      ),
      source<Order>(
        'orders',
        api.get(endpoints.orders.manage({ orderNumber: debounced, limit: 10 }), true),
      ),
      // A miss is not a failure here: most search terms are not phone numbers, and a
      // 404 for "budi" must not be reported as "customers could not be searched".
      PHONE_RE.test(debounced)
        ? api
            .get<Customer>(endpoints.auth.customerLookup(debounced), true)
            .then((c) => [c])
            .catch(() => [] as Customer[])
        : Promise.resolve([] as Customer[]),
    ]).then(([depots, staff, orders, customers]) => {
      if (!alive) return;
      setResults({ depots, staff, orders, customer: customers[0] ?? null });
      setUnreachable(failures);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [debounced]);

  const total =
    results.depots.length +
    results.staff.length +
    results.orders.length +
    (results.customer ? 1 : 0);
  // Translated at RENDER time, not inside the effect: a label captured in the effect would
  // pin `t` as a dependency and re-run every search on a language switch.
  const partial =
    unreachable.length > 0 ? unreachable.map((k) => t(`hq.search.groups.${k}`)).join(', ') : null;

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

      {/* One source down must not read as "nothing matched" — say which one could not be
          asked, above whatever the reachable ones did find. */}
      {partial && (
        <p
          className="rounded-xl border border-app bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800"
          role="status"
        >
          {t('hq.search.partial', { sources: partial })}
        </p>
      )}

      {!debounced ? (
        <p className="py-12 text-center text-sm text-muted">{t('hq.search.empty')}</p>
      ) : loading ? (
        <div className="flex justify-center py-12 text-brand-500">
          <Spinner size={26} />
        </div>
      ) : total === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          {t('hq.search.noResults', { q: debounced })}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {results.depots.length > 0 && (
            <Group
              icon={<Storefront size={16} weight="fill" />}
              title={t('hq.search.groups.depots')}
            >
              {results.depots.map((d) => (
                <Link key={d.id} href={`/hq/depots/detail?id=${d.id}`} className="block">
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
          {results.customer && (
            <Group icon={<User size={16} weight="fill" />} title={t('hq.search.groups.customers')}>
              <Link href="/hq/customers" className="block">
                <ResultRow
                  title={results.customer.fullName || results.customer.phone}
                  meta={results.customer.phone}
                />
              </Link>
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
