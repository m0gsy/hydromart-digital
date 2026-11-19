'use client';

import { useState } from 'react';
import { UsersThree } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ChurnCustomer, ChurnRiskBand } from '@/lib/types';

/*
 * Flow plan 5b: grouped by the risk band forecast-service computes (`riskBand`), the same one
 * the depot churn list shows. This screen used to bucket by its own day thresholds
 * (14 / 30 / 60 days since the last order) — a second churn rule, in the client, that could
 * call a customer "Aktif" here while the depot screen called them HIGH risk.
 */
const BANDS: { key: ChurnRiskBand; accent: string }[] = [
  { key: 'HIGH', accent: 'bg-red-500' },
  { key: 'MEDIUM', accent: 'bg-amber-500' },
  { key: 'LOW', accent: 'bg-green-500' },
];

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Design 17b — churn & retention. Real: forecast.churn.
//
// Re-engage creates and SENDS a real one-customer campaign. It used to toast "sudah
// dihubungi" and do nothing, so a customer who was never messaged looked exactly like one
// who was. The audience is `customerIds` rather than an explicit recipient list because
// this screen has no phone number — the customer directory supplies it, which also means
// a customer with no reachable number is refused rather than silently skipped.
export default function HqChurnPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const data = useAsync<{ customers: ChurnCustomer[] }>(() =>
    // No `days`: the server's own scoring window, the one the depot churn list asks with.
    // HQ asked with 90 while the depot used the default (45), and the same customer got two
    // different bands on the two screens.
    api.get(endpoints.forecast.churn({ limit: 100 }), true),
  );

  async function reengage(customer: ChurnCustomer) {
    setBusyId(customer.customerId);
    try {
      const created = await api.post<{ id: string }>(
        endpoints.crm.createCampaign,
        {
          name: t('hq.churn.campaignName', { name: customer.customerName ?? shortId(customer.customerId) }),
          messageTemplate: t('hq.churn.campaignMessage'),
          segment: { customerIds: [customer.customerId] },
        },
        true,
      );
      // A draft nobody dispatches is the same dead button one layer down.
      await api.post(endpoints.crm.sendCampaign(created.id), undefined, true);
      toast(t('hq.churn.reengaged'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.churn.reengageError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const customers = data.data?.customers ?? [];
  const grouped = BANDS.map((b) => ({
    ...b,
    rows: customers.filter((x) => x.riskBand === b.key),
  }));

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={UsersThree} title={t('hq.churn.title')} subtitle={t('hq.churn.subtitle')} />

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : customers.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.churn.emptyAll')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {grouped.map((c) => (
            <Card key={c.key} className="flex flex-col gap-3 p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${c.accent}`} />
                {t(`insight.customers.risk.${c.key}`)}
                <span className="text-sm font-normal text-muted">({c.rows.length})</span>
              </h2>
              {c.rows.length === 0 ? (
                <p className="py-2 text-sm text-muted">{t('hq.churn.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {c.rows.slice(0, 8).map((x) => (
                    <li key={x.customerId} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <span
                          className={`block ${x.customerName ? 'truncate text-sm font-medium' : 'font-mono text-xs'}`}
                        >
                          {x.customerName ?? shortId(x.customerId)}
                        </span>
                        <span className="block text-xs text-muted">
                          {t('hq.churn.daysSince', { n: x.daysSince })} · {t('hq.churn.orders', { n: x.orderCount })}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        loading={busyId === x.customerId}
                        onClick={() => reengage(x)}
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
