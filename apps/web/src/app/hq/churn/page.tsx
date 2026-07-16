'use client';

import { UsersThree } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ChurnCustomer } from '@/lib/types';

type Cohort = 'active' | 'slowing' | 'atRisk' | 'churned';

// Recency buckets (days since last order). Real data (forecast.churn) is bucketed here.
function cohortOf(daysSince: number): Cohort {
  if (daysSince < 14) return 'active';
  if (daysSince < 30) return 'slowing';
  if (daysSince < 60) return 'atRisk';
  return 'churned';
}

const COHORTS: { key: Cohort; accent: string }[] = [
  { key: 'active', accent: 'bg-green-500' },
  { key: 'slowing', accent: 'bg-amber-500' },
  { key: 'atRisk', accent: 'bg-orange-500' },
  { key: 'churned', accent: 'bg-red-500' },
];

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Design 17b — churn & retention. Real: forecast.churn. Re-engage is a stubbed action
// (no HQ campaign-enrol endpoint) — surfaced via toast, no fabricated numbers.
export default function HqChurnPage() {
  const { t } = useT();
  const { toast } = useToast();
  const data = useAsync<{ customers: ChurnCustomer[] }>(() =>
    api.get(endpoints.forecast.churn({ limit: 100, days: 90 }), true),
  );

  const customers = data.data?.customers ?? [];
  const grouped = COHORTS.map((c) => ({
    ...c,
    rows: customers.filter((x) => cohortOf(x.daysSince) === c.key),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <UsersThree size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.churn.title')}</h1>
          <p className="text-sm text-muted">{t('hq.churn.subtitle')}</p>
        </div>
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : customers.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.churn.emptyAll')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grouped.map((c) => (
            <Card key={c.key} className="flex flex-col gap-3 p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${c.accent}`} />
                {t(`hq.churn.${c.key}`)}
                <span className="text-sm font-normal text-muted">({c.rows.length})</span>
              </h2>
              {c.rows.length === 0 ? (
                <p className="py-2 text-sm text-muted">{t('hq.churn.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {c.rows.slice(0, 8).map((x) => (
                    <li key={x.customerId} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <span className="block font-mono text-xs">{shortId(x.customerId)}</span>
                        <span className="block text-xs text-muted">
                          {t('hq.churn.daysSince', { n: x.daysSince })} · {t('hq.churn.orders', { n: x.orderCount })}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => toast(t('hq.churn.reengaged'), 'success')}
                        className="shrink-0 px-3 py-1.5 text-xs"
                      >
                        {t('hq.churn.reengage')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
