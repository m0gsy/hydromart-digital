'use client';

import { useState } from 'react';
import { Gift, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { canHandOverRewards } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { RedemptionListItem } from '@/lib/types';

// M14-03 hand-over queue. The redemption itself carries no depot — points are a
// network-wide balance — so this lists every reward still awaiting collection rather
// than pretending to scope it to the selected depot.
function RedemptionQueue() {
  const { t } = useT();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<RedemptionListItem[]>(() =>
    api.get(endpoints.rewards.activeRedemptions, true),
  );
  const [pending, setPending] = useState<string | null>(null);

  async function markUsed(row: RedemptionListItem) {
    setPending(row.id);
    try {
      await api.post(endpoints.rewards.markRedemptionUsed(row.id), {}, true);
      toast(t('dashB.redemptions.marked'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('dashB.redemptions.markError'), 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gift size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashB.redemptions.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{t('dashB.redemptions.subtitle')}</p>
        </div>
      </div>

      <p className="rounded-xl bg-[color:var(--surface-soft)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
        {t('dashB.redemptions.hint')}
      </p>

      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-[color:var(--text-muted)]">
          {t('dashB.redemptions.empty')}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{row.rewardName}</div>
                  <div className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                    {t('dashB.redemptions.waiting', { time: formatDateTime(row.createdAt) })} ·{' '}
                    {t('dashB.redemptions.points', { n: row.pointsSpent.toLocaleString('id-ID') })}
                  </div>
                </div>
                <code className="rounded-lg border border-dashed border-app px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wide">
                  {t('dashB.redemptions.code')} {row.id.slice(0, 8)}
                </code>
                <Button loading={pending === row.id} onClick={() => markUsed(row)}>
                  {t('dashB.redemptions.markUsed')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canHandOverRewards(customer?.role)) {
    return (
      <CenterState title={t('dashB.redemptions.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.redemptions.gateBody')}
      </CenterState>
    );
  }
  return <RedemptionQueue />;
}

export default function RedemptionsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
