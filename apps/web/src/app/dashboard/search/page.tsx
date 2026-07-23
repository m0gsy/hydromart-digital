'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlass, Storefront, Package, User, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Input, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, DepotAdmin, Page, Product } from '@/lib/types';

// ponytail: client-side fan-out over existing search endpoints (depots/products/
// customer-by-phone). A server-side unified endpoint incl. orders is the follow-up.
interface Results {
  depots: DepotAdmin[];
  products: Product[];
  customer: Customer | null;
}

const PHONE_RE = /^\+?\d[\d\s-]{6,}$/;

// Each section may 403/404 for the caller's role or a miss — swallow and return empty.
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

async function runSearch(q: string): Promise<Results> {
  const [depotPage, productPage, customer] = await Promise.all([
    safe(api.get<Page<DepotAdmin>>(endpoints.depots.manage({ search: q, limit: 8 }), true), {
      items: [],
    } as unknown as Page<DepotAdmin>),
    safe(api.get<Page<Product>>(endpoints.products.browse({ search: q, limit: 8 }), true), {
      items: [],
    } as unknown as Page<Product>),
    PHONE_RE.test(q.trim())
      ? safe(api.get<Customer>(endpoints.auth.customerLookup(q.trim()), true), null)
      : Promise.resolve(null),
  ]);
  return { depots: depotPage.items ?? [], products: productPage.items ?? [], customer };
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-extrabold text-muted">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function SearchBody() {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const res = useAsync<Results | null>(() => (q.trim() ? runSearch(q.trim()) : Promise.resolve(null)), [q]);

  const total = res.data ? res.data.depots.length + res.data.products.length + (res.data.customer ? 1 : 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <MagnifyingGlass size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashC.search.heading')}</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('dashC.search.placeholder')}
          autoFocus
        />
      </form>

      {!q.trim() ? (
        <CenterState title={t('dashC.search.startTitle')} icon={<MagnifyingGlass size={40} weight="fill" />}>
          {t('dashC.search.startBody')}
        </CenterState>
      ) : res.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : total === 0 ? (
        <CenterState title={t('dashC.search.noResultsTitle')} icon={<MagnifyingGlass size={40} weight="fill" />}>
          {t('dashC.search.noResultsBody', { q })}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-5">
          <Section title={t('dashC.search.depots')} icon={<Storefront size={16} weight="fill" />} count={res.data!.depots.length}>
            {res.data!.depots.map((d) => (
              <Link key={d.id} href="/dashboard/depots">
                <Card className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:border-brand-600">
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs text-muted">
                      {d.code} · {d.city}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </Section>

          <Section title={t('dashC.search.products')} icon={<Package size={16} weight="fill" />} count={res.data!.products.length}>
            {res.data!.products.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3 p-3.5">
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted">{p.sku}</p>
                </div>
                <Money amount={p.basePrice} className="font-semibold" />
              </Card>
            ))}
          </Section>

          {res.data!.customer && (
            <Section title={t('dashC.search.customers')} icon={<User size={16} weight="fill" />} count={1}>
              <Card className="p-3.5">
                <p className="font-semibold">{res.data!.customer.fullName || res.data!.customer.phone}</p>
                <p className="text-xs text-muted">{res.data!.customer.phone}</p>
              </Card>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title={t('dashC.search.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.search.gateBody')}
      </CenterState>
    );
  }
  return <SearchBody />;
}

export default function SearchPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
