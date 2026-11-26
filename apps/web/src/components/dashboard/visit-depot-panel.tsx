'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { FindingState, VisitItem, VisitPage, VisitSummary } from '@/lib/visits';
import { todayWib } from '@/lib/wib';

const STATES: FindingState[] = ['open', 'overdue', 'done'];
const STATE_KEY = { open: 'stateOpen', overdue: 'stateOverdue', done: 'stateDone' } as const;

function Finding({ item, onClosed }: { item: VisitItem; onClosed: () => void }) {
  const { t } = useT();
  const { customer } = useAuth();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = item.followUpStatus === 'DONE';
  const overdue = !done && !!item.followUpDueOn && item.followUpDueOn < todayWib();

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.visits.closeFollowUp(item.id),
        { note: note.trim() || undefined },
        true,
      );
      onClosed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('opsFix.visits.closeFailed'));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold">{item.text}</p>
        {done ? (
          <Badge tone="success">{t('opsFix.visits.stateDone')}</Badge>
        ) : (
          overdue && <Badge tone="danger">{t('opsFix.visits.stateOverdue')}</Badge>
        )}
      </div>
      {item.findingNote && <p className="text-sm">{item.findingNote}</p>}
      <p className="text-xs text-muted">
        {item.followUpDueOn && t('opsFix.visits.dueOn', { date: formatDate(item.followUpDueOn) })}
        {done &&
          item.followUpDoneAt &&
          ` · ${t('opsFix.visits.doneOn', { date: formatDate(item.followUpDoneAt) })}`}
      </p>
      {item.followUpNote && <p className="text-xs">{item.followUpNote}</p>}
      {item.photoUrl && (
        <a
          href={item.photoUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-brand-700"
        >
          {t('opsFix.visits.photo')}
        </a>
      )}
      {!done &&
        can('visitFollowUp', customer?.role) &&
        (closing ? (
          <div className="space-y-2">
            <textarea
              aria-label={t('opsFix.visits.doneNote')}
              placeholder={t('opsFix.visits.doneNote')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-xl border border-app bg-[color:var(--surface)] px-3.5 py-3 text-[13px]"
            />
            {error && (
              <p role="alert" className="text-sm font-medium text-[color:var(--danger)]">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button loading={busy} onClick={close}>
                {t('opsFix.visits.confirmDone')}
              </Button>
              <Button variant="secondary" onClick={() => setClosing(false)}>
                {t('opsFix.visits.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setClosing(true)}>
            {t('opsFix.visits.markDone')}
          </Button>
        ))}
    </Card>
  );
}

/** One depot's visits and its findings by follow-up state (HD-15B PR-5). */
export function VisitDepotPanel({ depotId }: { depotId: string }) {
  const { t } = useT();
  const [state, setState] = useState<FindingState>('open');
  const visits = useAsync<VisitPage<VisitSummary>>(
    () => api.get(endpoints.visits.list(depotId), true),
    [depotId],
  );
  const findings = useAsync<VisitPage<VisitItem>>(
    () => api.get(endpoints.visits.findings(depotId, state), true),
    [depotId, state],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-bold">{t('opsFix.visits.findingsTitle')}</h2>
        <div role="group" aria-label={t('opsFix.visits.findingsTitle')} className="flex gap-2">
          {STATES.map((s) => (
            <Button
              key={s}
              variant={s === state ? 'primary' : 'secondary'}
              aria-pressed={s === state}
              onClick={() => setState(s)}
            >
              {t(`opsFix.visits.${STATE_KEY[s]}`)}
            </Button>
          ))}
        </div>
        {findings.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : findings.error ? (
          <ErrorState message={t('opsFix.visits.loadError')} onRetry={findings.reload} />
        ) : findings.data?.items.length ? (
          findings.data.items.map((i) => <Finding key={i.id} item={i} onClosed={findings.reload} />)
        ) : (
          <p className="text-sm text-muted">{t('opsFix.visits.noFindings')}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold">{t('opsFix.visits.visitsTitle')}</h2>
        {visits.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : visits.error ? (
          <ErrorState message={t('opsFix.visits.loadError')} onRetry={visits.reload} />
        ) : visits.data?.items.length ? (
          visits.data.items.map((v) => (
            <Link key={v.id} href={`/dashboard/visits/detail?id=${v.id}`} className="block">
              <Card className="p-4">
                <p className="text-sm font-semibold">{v.templateName}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(v.checkInAt)} ·{' '}
                  {t('opsFix.visits.visitMeta', {
                    status: t(
                      v.status === 'COMPLETED'
                        ? 'opsFix.visits.statusCompleted'
                        : 'opsFix.visits.statusInProgress',
                    ),
                    findings: v.findingCount,
                    items: v.itemCount,
                  })}
                </p>
              </Card>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted">{t('opsFix.visits.noVisits')}</p>
        )}
      </section>
    </div>
  );
}
