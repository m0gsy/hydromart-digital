'use client';

import { useRouter } from 'next/navigation';
import { Buildings } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { CommissionScheme, Customer, DepotAdmin, Page, PendingPayout } from '@/lib/types';

// Design 5c — the franchise network seen from head office: every WARALABA depot, who owns
// it, what HQ takes, and what is waiting to be released to that owner. Every column is real
// and already served; only the three finance reads are best-effort, because a HEAD_OFFICE
// viewer without the finance capability gets a 403 there and should still see the directory.
export default function HqFranchisePage() {
  const { t } = useT();
  const router = useRouter();

  const depots = useAsync<Page<DepotAdmin>>(() =>
    api.getCached(endpoints.depots.manage({ limit: 100, ownershipType: 'WARALABA' }), true),
  );
  const owners = useAsync<Customer[]>(() =>
    api
      .get<Page<Customer>>(endpoints.auth.staff({ role: 'FRANCHISE_OWNER', limit: 100 }), true)
      .then((page) => page.items)
      .catch(() => []),
  );
  const schemes = useAsync<CommissionScheme[]>(() =>
    api.get<CommissionScheme[]>(endpoints.commission.schemes, true).catch(() => []),
  );
  const queue = useAsync<PendingPayout[]>(() =>
    api.get<PendingPayout[]>(endpoints.payout.hqQueue, true).catch(() => []),
  );

  if (depots.loading) return <Skeleton className="h-96 w-full" />;
  if (depots.error) return <ErrorState message={depots.error} onRetry={depots.reload} />;

  const items = depots.data?.items ?? [];
  const ownerName = new Map((owners.data ?? []).map((o) => [o.id, o.fullName || o.phone]));
  const pctByDepot = new Map((schemes.data ?? []).map((s) => [s.depotId, s.pct]));
  const pendingByOwner = new Map((queue.data ?? []).map((p) => [p.franchiseOwnerId, p.availableBalance]));

  // An ownerless franchise depot books its revenue to nobody. New ones are refused outright;
  // these are the rows created before that rule, and they are the reason this count is shown.
  const orphans = items.filter((d) => !d.ownerId).length;
  const pendingTotal = items.reduce(
    (sum, d) => sum + (d.ownerId ? (pendingByOwner.get(d.ownerId) ?? 0) : 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Buildings}
        title={t('hq.franchise.title')}
        subtitle={t('hq.franchise.subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand">{t('hq.franchise.count', { n: items.length })}</Badge>
            {orphans > 0 && <Badge tone="danger">{t('hq.franchise.orphans', { n: orphans })}</Badge>}
          </div>
        }
      />

      {pendingTotal > 0 && (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">{t('hq.franchise.pendingTitle')}</p>
            <p className="text-xs text-muted">{t('hq.franchise.pendingHint')}</p>
          </div>
          <Money amount={pendingTotal} className="text-lg font-bold" />
        </Card>
      )}

      {items.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.franchise.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((d) => {
            const pct = pctByDepot.get(d.id);
            const pending = d.ownerId ? pendingByOwner.get(d.ownerId) : undefined;
            return (
              <Card
                key={d.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.name}</span>
                    <Badge tone="neutral">{d.code}</Badge>
                    {!d.active && <Badge tone="warning">{t('hq.franchise.inactive')}</Badge>}
                  </div>
                  <p className="mt-1 text-sm">
                    {d.ownerId ? (
                      (ownerName.get(d.ownerId) ?? t('hq.franchise.ownerUnknown'))
                    ) : (
                      <span className="font-medium text-red-600">{t('hq.franchise.noOwner')}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {d.city} · {pct === undefined ? t('hq.franchise.noScheme') : t('hq.franchise.pct', { n: pct })}
                    {pending !== undefined && ` · ${t('hq.franchise.pendingRow')}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pending !== undefined && <Money amount={pending} className="font-semibold" />}
                  <Button variant="secondary" onClick={() => router.push(`/hq/depots/detail?id=${d.id}`)}>
                    {t('hq.franchise.open')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
