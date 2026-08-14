'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/locale-context';
import { MagnifyingGlass, Users } from '@phosphor-icons/react';

import { HrDepotPicker } from '@/components/hr/depot-picker';
import { Card, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { DepotCustomer } from '@/lib/types';

/**
 * Read-only customer directory inside the HR console. Reads the SAME depot CRM
 * endpoint the depot console uses (HR holds `depotCrm` read) — no second copy of
 * customer data inside hr-service, and no write actions from here.
 */
export default function HrCustomersPage() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const rows = useAsync<DepotCustomer[]>(
    () =>
      scopedId ? api.get(endpoints.depotCrm.list(scopedId, q || undefined), true) : Promise.resolve([]),
    [scopedId, q],
  );

  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Users size={24} weight="fill" className="text-brand-500" />
            {t('hrFix.hrCustomers.customers2')}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Hanya lihat. Data dibaca langsung dari direktori depot.
            {depot && (
              <>
                {' '}
                Depot: <strong className="text-[color:var(--text)]">{depot.name}</strong>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <HrDepotPicker />
          <div className="relative">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('hrFix.hrCustomers.searchHint')}
            aria-label={t('hrFix.hrCustomers.searchAria')}
            className="pl-9"
          />
          </div>
        </div>
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('hrFix.hrCustomers.noDepot')} icon={<Users size={40} weight="fill" />} />
      ) : rows.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.reload} />
      ) : (rows.data ?? []).length === 0 ? (
        <CenterState title={t('hrFix.hrCustomers.noCustomers')} icon={<Users size={40} weight="fill" />} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[12.5px] text-muted">
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrCustomers.name')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrCustomers.phone')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrCustomers.tier')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrCustomers.orders')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('hrFix.hrCustomers.lastOrder')}</th>
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((c) => (
                <tr key={c.id} className="border-t border-app">
                  <td className="px-4 py-2.5 font-semibold">{c.fullName ?? '—'}</td>
                  <td className="px-4 py-2.5">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2.5">{c.membershipTier}</td>
                  <td className="px-4 py-2.5 tabular-nums">{c.orderCount ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {c.lastOrderAt ? formatDateTime(c.lastOrderAt) : '—'}
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
