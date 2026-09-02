'use client';

import { Timer } from '@phosphor-icons/react';

import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { SweepStatus, SweepVerdict } from '@/lib/types';

/*
 * CA-5-01 — the seventeen scheduled sweeps, on a screen.
 *
 * `check-scheduler-routes.mjs` already proves a sweep CAN run. Nothing showed whether one
 * still IS running: `sweep.sh` wrote each outcome into empty marker files inside the
 * scheduler container, and the container healthcheck read exactly one of them
 * (`last-success`) as a single yes/no for all seventeen jobs at once.
 *
 * Measured on the dev box the day this was written: FailingStreak 1472, every sweep failing
 * for ~25 hours, and two jobs with no marker file of EITHER kind — meaning they had never
 * run at all. Learning any of that took `docker inspect`.
 *
 * It lives on /hq/health rather than its own page for the same reason OutboxCard does: this
 * is the screen somebody opens when they suspect something has stopped.
 */
const VERDICT_TONE: Record<SweepVerdict, 'success' | 'danger' | 'warning' | 'neutral'> = {
  OK: 'success',
  // NEVER_RAN is danger, not warning: a sweep that has never run once is a feature that has
  // never worked, and it is the exact state the old marker files could not express at all.
  NEVER_RAN: 'danger',
  FAILING: 'danger',
  OVERDUE: 'warning',
  // A switched-off sweep being quiet is a decision, not a fault. Showing it as one is how a
  // deliberate decision gets "fixed" by somebody flipping the switch back on.
  DORMANT: 'neutral',
};

function ago(iso: string | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return t('hq.sweeps.minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('hq.sweeps.hoursAgo', { n: hours });
  return t('hq.sweeps.daysAgo', { n: Math.round(hours / 24) });
}

export function SweepCard() {
  const { t } = useT();
  const query = useAsync<SweepStatus[]>(() => api.get(endpoints.admin.sweeps, true));

  const sweeps = query.data ?? [];
  // The service already sorts worst-first; this only counts for the header badge.
  const broken = sweeps.filter(
    (s) => s.verdict === 'NEVER_RAN' || s.verdict === 'FAILING' || s.verdict === 'OVERDUE',
  ).length;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Timer size={18} weight="fill" className="text-brand-500" />
            {t('hq.sweeps.title')}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">{t('hq.sweeps.subtitle')}</p>
        </div>
        {!query.loading && !query.error && (
          <Badge tone={broken === 0 ? 'success' : 'danger'}>
            {broken === 0
              ? t('hq.sweeps.allRunning', { total: sweeps.length })
              : t('hq.sweeps.brokenCount', { n: broken, total: sweeps.length })}
          </Badge>
        )}
      </div>

      {query.loading && <Skeleton className="h-40 w-full" />}
      {query.error && <ErrorState message={query.error} onRetry={query.reload} />}

      {!query.loading && !query.error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5">{t('hq.sweeps.job')}</th>
                <th className="px-3 py-2.5">{t('hq.sweeps.verdict')}</th>
                <th className="px-3 py-2.5">{t('hq.sweeps.lastRun')}</th>
                <th className="px-3 py-2.5">{t('hq.sweeps.lastOk')}</th>
                <th className="px-3 py-2.5">{t('hq.sweeps.every')}</th>
              </tr>
            </thead>
            <tbody>
              {sweeps.map((s) => (
                <tr key={s.job} className="border-b border-app align-top last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{s.label}</div>
                    <div className="font-mono text-[11px] text-muted">{s.job}</div>
                    {/*
                      The reason a sweep is switched off, in the row itself. Without it the
                      quiet row reads as a fault, and "fixing" this particular one writes
                      permanently to every customer's points balance.
                    */}
                    {s.dormantReason && (
                      <div className="mt-1 max-w-md text-[11px] text-muted">{s.dormantReason}</div>
                    )}
                    {s.verdict === 'FAILING' && s.detail && (
                      <div className="mt-1 max-w-md break-words font-mono text-[11px] text-red-700">
                        {s.detail}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={VERDICT_TONE[s.verdict]}>{t(`hq.sweeps.${s.verdict}`)}</Badge>
                    {s.consecutiveFailures > 1 && (
                      <div className="mt-1 text-[11px] tabular-nums text-red-700">
                        {t('hq.sweeps.consecutive', { n: s.consecutiveFailures })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{ago(s.lastRunAt, t)}</td>
                  {/*
                    Beside "last run" on purpose, never folded into it: a job that ran a
                    minute ago and last WORKED three days ago is the shape the old shared
                    heartbeat rendered as perfectly healthy.
                  */}
                  <td className="px-3 py-2.5 tabular-nums">{ago(s.lastOkAt, t)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">
                    {t('hq.sweeps.everyMinutes', { n: s.everyMinutes })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
