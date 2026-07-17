'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Check, ListChecks } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Customer, DepotAdmin, InventoryItem, Page } from '@/lib/types';

const selectClass =
  'surface-elevated w-full max-w-xs rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

// Design 15d — depot go-live checklist. The six canonical steps are fixed; each step's
// done-state is DERIVED from real system signals for the selected depot (no separate
// onboarding-workflow store). Legal + survey are prerequisites to provisioning, so a
// depot that exists in the system has cleared them.
const STEPS = [
  { id: 'legal', ownerKey: 'legal' as const },
  { id: 'survey', ownerKey: 'ops' as const },
  { id: 'provision', ownerKey: 'hq' as const, href: '/hq/depots?onboard=1' },
  { id: 'stock', ownerKey: 'manager' as const, href: '/hq/catalog' },
  { id: 'staff', ownerKey: 'hq' as const, href: '/hq/staff' },
  { id: 'payments', ownerKey: 'finance' as const, href: '/hq/payments' },
];

export default function HqOnboardingPage() {
  const { t } = useT();
  const [depotId, setDepotId] = useState('');

  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const depot = useAsync<DepotAdmin | null>(
    () => (depotId ? api.get<DepotAdmin>(endpoints.depots.detail(depotId), true) : Promise.resolve(null)),
    [depotId],
  );
  const inv = useAsync<InventoryItem[]>(
    () => (depotId ? api.get<InventoryItem[]>(endpoints.inventory.lines(depotId), true) : Promise.resolve([])),
    [depotId],
  );
  const staff = useAsync<{ total: number }>(
    () =>
      depotId
        ? api.get<{ items: Customer[]; total: number }>(endpoints.auth.staff({ depotId, limit: 1 }), true)
        : Promise.resolve({ total: 0 }),
    [depotId],
  );

  const d = depot.data;
  // Derived readiness per step. Legal/survey/provision are proven by the depot existing.
  const doneById: Record<string, boolean> = {
    legal: !!d,
    survey: !!d,
    provision: !!d,
    stock: (inv.data ?? []).length > 0,
    staff: (staff.data?.total ?? 0) > 0,
    payments: !!(d?.paymentBankAccountNumber || d?.paymentQrisImageUrl),
  };

  const loading = depot.loading || inv.loading || staff.loading;
  const doneCount = STEPS.filter((s) => doneById[s.id]).length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={ListChecks}
        title={t('hq.onboarding.title')}
        subtitle={t('hq.onboarding.subtitle')}
        action={
          d ? <Badge tone="brand">{t('hq.onboarding.progress', { done: doneCount, total: STEPS.length })}</Badge> : undefined
        }
      />

      <select value={depotId} onChange={(e) => setDepotId(e.target.value)} className={selectClass}>
        <option value="">{t('hq.onboarding.pickDepot')}</option>
        {(depots.data?.items ?? []).map((dp) => (
          <option key={dp.id} value={dp.id}>
            {dp.name}
          </option>
        ))}
      </select>

      {!depotId ? (
        <p className="py-6 text-center text-sm text-muted">{t('hq.onboarding.pickPrompt')}</p>
      ) : loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
          </div>

          <ol className="flex flex-col gap-3">
            {STEPS.map((s, i) => {
              const isDone = doneById[s.id];
              return (
                <Card key={s.id} className="flex items-center gap-3 p-4">
                  <span
                    className={
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                      (isDone
                        ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                        : 'bg-[color:var(--surface-soft)] text-muted')
                    }
                  >
                    {isDone ? <Check size={16} weight="bold" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={'font-semibold ' + (isDone ? 'text-muted line-through' : '')}>
                      {t(`hq.onboarding.steps.${s.id}`)}
                    </p>
                    <p className="text-xs text-muted">{t(`hq.onboarding.owners.${s.ownerKey}`)}</p>
                  </div>
                  {isDone ? (
                    <Badge tone="success">{t('hq.onboarding.done')}</Badge>
                  ) : s.href ? (
                    <Link
                      href={s.href}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
                    >
                      {t('hq.onboarding.open')}
                      <ArrowRight size={14} weight="bold" />
                    </Link>
                  ) : (
                    <Badge tone="neutral">{t('hq.onboarding.todo')}</Badge>
                  )}
                </Card>
              );
            })}
          </ol>

          <p className="text-xs text-muted">{t('hq.onboarding.derivedHint')}</p>
        </>
      )}
    </div>
  );
}
