'use client';

import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { VisitDepotPanel } from '@/components/dashboard/visit-depot-panel';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, LinkButton, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Visit, VisitOverview } from '@/lib/visits';

function Body() {
  const { t } = useT();
  const { customer } = useAuth();
  const conduct = can('visitConduct', customer?.role);
  const overview = useAsync<VisitOverview>(() => api.get(endpoints.visits.overview, true), []);
  const open = useAsync<Visit[]>(
    () => (conduct ? api.get(endpoints.visits.mineOpen, true) : Promise.resolve([])),
    [conduct],
  );
  const [picked, setPicked] = useState<string | null>(null);

  const depots = overview.data?.depots ?? [];
  // A Kepala depot sees one depot: no need to ask which.
  const selected = picked ?? (depots.length === 1 ? (depots[0]?.depotId ?? null) : null);
  const unfenced = depots.reduce((n, d) => n + d.unfencedVisitsLast30d, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('opsFix.visits.title')}</h1>
          <p className="text-sm text-muted">{t('opsFix.visits.subtitle')}</p>
        </div>
        {conduct && (
          <LinkButton href="/dashboard/visits/new">{t('opsFix.visits.start')}</LinkButton>
        )}
      </div>

      {conduct && !!open.data?.length && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">{t('opsFix.visits.openTitle')}</h2>
          {open.data.map((v) => (
            <Card key={v.id} className="flex items-center justify-between gap-3 p-4">
              <p className="min-w-0 text-sm">
                {t('opsFix.visits.openMeta', {
                  template: v.templateName,
                  time: formatDateTime(v.checkInAt),
                })}
              </p>
              <LinkButton href={`/dashboard/visits/detail?id=${v.id}`} variant="secondary">
                {t('opsFix.visits.resume')}
              </LinkButton>
            </Card>
          ))}
        </section>
      )}

      {overview.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : overview.error ? (
        <ErrorState message={t('opsFix.visits.loadError')} onRetry={overview.reload} />
      ) : depots.length === 0 ? (
        <p className="text-sm text-muted">{t('opsFix.visits.noDepots')}</p>
      ) : (
        <section className="space-y-3">
          <h2 className="text-base font-bold">{t('opsFix.visits.depotsTitle')}</h2>
          {overview.data?.truncated && (
            <p role="status" className="rounded-xl bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
              {t('opsFix.visits.truncated')}
            </p>
          )}
          {unfenced > 0 && (
            <p role="status" className="rounded-xl bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
              {t('opsFix.visits.unfenced', { n: unfenced })}
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {depots.map((d) => (
              <li key={d.depotId}>
                <button
                  type="button"
                  aria-pressed={d.depotId === selected}
                  onClick={() => setPicked(d.depotId)}
                  className="w-full text-left"
                >
                  <Card
                    className={`space-y-1 p-4 ${d.depotId === selected ? 'ring-2 ring-brand-600' : ''}`}
                  >
                    <p className="text-sm font-semibold">{d.depotName}</p>
                    <p className="text-xs text-muted">
                      {d.lastVisitAt
                        ? t('opsFix.visits.lastVisit', { date: formatDate(d.lastVisitAt) })
                        : t('opsFix.visits.neverVisited')}
                    </p>
                    <p className="text-xs">{t('opsFix.visits.visits30', { n: d.visitsLast30d })}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={d.openFindings ? 'warning' : 'neutral'}>
                        {t('opsFix.visits.openFindings', { n: d.openFindings })}
                      </Badge>
                      {d.overdueFollowUps > 0 && (
                        <Badge tone="danger">
                          {t('opsFix.visits.overdue', { n: d.overdueFollowUps })}
                        </Badge>
                      )}
                    </div>
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && <VisitDepotPanel key={selected} depotId={selected} />}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('visitRead', customer?.role)) {
    return (
      <CenterState title={t('opsFix.visits.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.visits.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function VisitsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
