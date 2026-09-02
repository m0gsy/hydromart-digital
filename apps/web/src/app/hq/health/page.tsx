'use client';

import { useState } from 'react';
import { ArrowsClockwise, Heartbeat, Queue } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { SweepCard } from '@/components/hq/sweep-card';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ServiceHealth, SystemHealth } from '@/lib/types';

// Design 13b — aggregate per-service health. Real admin-service track: the roll-up fans out
// to each service's /health server-side and returns a real up/down + latency per service.
const STATUS_TONE: Record<ServiceHealth['status'], 'success' | 'danger'> = {
  up: 'success',
  down: 'danger',
};

/*
 * PAR-09. The outbox gauge, and the drain button beside it.
 *
 * `GET /orders/outbox/pending` was written "so a queue that stops draining is visible" and
 * no screen ever read it — so it was visible to nobody, and a PENDING row with money owed
 * against it (a stock consume, a loyalty award, an owner's commission) could sit there
 * indefinitely with the happy path looking perfectly healthy.
 *
 * It belongs on /hq/health rather than its own page for the same reason the service table
 * does: this is the screen somebody opens when they suspect something has stopped.
 */
function OutboxCard() {
  const { t } = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const counts = useAsync<Record<string, number>>(() =>
    api.get(endpoints.orderOutbox.pending, true),
  );

  async function drain() {
    setBusy(true);
    try {
      const result = await api.post<{ delivered?: number; failed?: number }>(
        endpoints.orderOutbox.process,
        {},
        true,
      );
      toast(
        t('hq.outbox.drained', {
          delivered: result?.delivered ?? 0,
          failed: result?.failed ?? 0,
        }),
        'success',
      );
      counts.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.outbox.drainError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const pending = counts.data?.PENDING ?? 0;
  const done = counts.data?.DONE ?? 0;
  const dead = counts.data?.DEAD ?? 0;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Queue size={18} weight="fill" className="text-brand-500" />
            {t('hq.outbox.title')}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">{t('hq.outbox.subtitle')}</p>
        </div>
        <Button disabled={busy || counts.loading} onClick={() => void drain()}>
          {t('hq.outbox.drain')}
        </Button>
      </div>

      {counts.loading && !counts.data ? (
        <Skeleton className="h-16 w-full" />
      ) : counts.error ? (
        <ErrorState message={counts.error ?? t('hq.outbox.loadError')} onRetry={counts.reload} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {/*
            PENDING first and loudest. `dead` matters too — a row the sweep gave up on is
            an effect that will never be delivered unless a person does something.
          */}
          <div className="rounded-xl border border-app p-4">
            <div className="text-xs text-muted">{t('hq.outbox.pending')}</div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                pending > 0 ? 'text-amber-600' : ''
              }`}
            >
              {pending}
            </div>
          </div>
          <div className="rounded-xl border border-app p-4">
            <div className="text-xs text-muted">{t('hq.outbox.dead')}</div>
            <div className={`text-2xl font-bold tabular-nums ${dead > 0 ? 'text-red-600' : ''}`}>
              {dead}
            </div>
          </div>
          <div className="rounded-xl border border-app p-4">
            <div className="text-xs text-muted">{t('hq.outbox.done')}</div>
            <div className="text-2xl font-bold tabular-nums">{done}</div>
          </div>
        </div>
      )}
    </Card>
  );
}

/*
 * The two read-model backfills. Same story as the outbox above: built, SUPER_ADMIN-only,
 * and reachable from no screen — so the only recovery for a recommendation or forecast
 * model that had drifted (or was never populated at all) was a hand-made HTTP request.
 *
 * Here rather than on the forecast screens because this is a REPAIR, not a report: the
 * person pressing it has noticed something is stale, which is the same reason they opened
 * this page.
 */
function BackfillCard() {
  const { t } = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function rebuild(key: 'forecast' | 'recommendations', url: string) {
    setBusy(key);
    try {
      const result = await api.post<{ ingested?: number }>(url, {}, true);
      toast(t('hq.backfill.done', { n: result?.ingested ?? 0 }), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.backfill.failed'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <ArrowsClockwise size={18} weight="bold" className="text-brand-500" />
          {t('hq.backfill.title')}
        </h2>
        <p className="mt-0.5 max-w-2xl text-xs text-muted">{t('hq.backfill.subtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void rebuild('forecast', endpoints.readModelRebuild.forecast)}
        >
          {t('hq.backfill.run')} · {t('hq.backfill.forecast')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() =>
            void rebuild('recommendations', endpoints.readModelRebuild.recommendations)
          }
        >
          {t('hq.backfill.run')} · {t('hq.backfill.recommendations')}
        </Button>
      </div>
    </Card>
  );
}

export default function HqHealthPage() {
  const { t } = useT();
  const query = useAsync<SystemHealth>(() => api.get(endpoints.admin.health, true));

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error) return <ErrorState message={t('hq.health.loadError')} onRetry={query.reload} />;

  const { services, upCount, total } = query.data!;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Heartbeat}
        title={t('hq.health.title')}
        subtitle={t('hq.health.subtitle')}
        action={
          <Badge tone={upCount === total ? 'success' : 'warning'}>
            {t('hq.health.summary', { up: upCount, total })}
          </Badge>
        }
      />

      <SweepCard />

      <OutboxCard />

      <BackfillCard />

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">{t('hq.health.service')}</th>
              <th className="px-4 py-2.5">{t('hq.health.status')}</th>
              <th className="px-4 py-2.5 text-right">{t('hq.health.latency')}</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5 font-mono text-[13px] font-semibold">{s.name}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS_TONE[s.status]}>{t(`hq.health.${s.status}`)}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t('hq.health.ms', { n: s.latencyMs })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
