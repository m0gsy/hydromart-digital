'use client';

import { useRouter } from 'next/navigation';
import { Buildings } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, LoadError, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { fetchAllDepots } from '@/lib/all-depots';
import { useAsync } from '@/lib/use-async';
import type { CommissionScheme, Customer, DepotAdmin, Page, PendingPayout } from '@/lib/types';

// Design 5c — the franchise network seen from head office: every WARALABA depot, who owns
// it, what HQ takes, and what is waiting to be released to that owner. Every column is real
// and already served; only the three finance reads are best-effort, because a HEAD_OFFICE
// viewer without the finance capability gets a 403 there and should still see the directory.
export default function HqFranchisePage() {
  const { t } = useT();
  const router = useRouter();

  /*
   * CA-2-26. Three numbers on this screen are computed from this read — the franchise count
   * in the header, the ownerless-depot count beside it, and the total pending payout below —
   * and all three were the length of a 100-row slice presented as the size of the network.
   * The orphan count is the one that matters most: it exists to be chased to zero, and a
   * hundred-and-first ownerless depot books its revenue to nobody while the badge says the
   * problem is smaller than it is.
   */
  const depots = useAsync<DepotAdmin[]>(() => fetchAllDepots({ ownershipType: 'WARALABA' }));
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

  const items = depots.data ?? [];
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

      {/* Three side reads feed this screen and each one goes quiet as a claim: no scheme
          agreed, no owner on file, nothing owed. The card below hides itself at 0. */}
      {(schemes.error || queue.error || owners.error) && (
        <LoadError
          onRetry={() => {
            if (schemes.error) schemes.reload();
            if (queue.error) queue.reload();
            if (owners.error) owners.reload();
          }}
        />
      )}

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
