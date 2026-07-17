'use client';

import { useState } from 'react';
import { WarningOctagon } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { agoLabel } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/types';

// Design 14c — incident timeline. Real admin-service track: HEAD_OFFICE + SUPER_ADMIN.
// List (newest-first) + open incident + patch (append a timeline update / resolve).
type Filter = 'all' | IncidentStatus;
const SEVERITIES: IncidentSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];

const SEV_TONE: Record<IncidentSeverity, 'danger' | 'warning' | 'neutral'> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  INFO: 'neutral',
};
const SEV_DOT: Record<IncidentSeverity, string> = {
  CRITICAL: 'bg-red-500',
  WARNING: 'bg-amber-500',
  INFO: 'bg-brand-500',
};
const STATUS_TONE: Record<IncidentStatus, 'warning' | 'success'> = {
  ONGOING: 'warning',
  RESOLVED: 'success',
};

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function HqIncidentsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const query = useAsync<Incident[]>(
    () => api.get(endpoints.admin.incidents.list({ status: filter === 'all' ? undefined : filter }), true),
    [filter],
  );

  const chips: Filter[] = ['all', 'ONGOING', 'RESOLVED'];
  const label = (f: Filter) => (f === 'all' ? t('hq.incidents.all') : t(`hq.incidents.status.${f}`));

  async function resolve(i: Incident) {
    try {
      await api.patch(endpoints.admin.incidents.update(i.id), { status: 'RESOLVED' }, true);
      toast(t('hq.incidents.resolvedOk'), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.incidents.saveError'), 'error');
    }
  }

  const rows = query.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={WarningOctagon}
        title={t('hq.incidents.title')}
        subtitle={t('hq.incidents.subtitle')}
        action={<Button onClick={() => setCreating(true)}>{t('hq.incidents.add')}</Button>}
      />

      <div className="flex flex-wrap gap-2">
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
              filter === f ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
            }`}
          >
            {label(f)}
          </button>
        ))}
      </div>

      {query.loading ? (
        <Skeleton className="h-80 w-full" />
      ) : query.error ? (
        <ErrorState message={t('hq.incidents.loadError')} onRetry={query.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.incidents.empty')}</p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className={'mt-1 h-2.5 w-2.5 shrink-0 rounded-full ' + SEV_DOT[r.severity]} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEV_TONE[r.severity]}>{t(`hq.incidents.severity.${r.severity}`)}</Badge>
                    <span className="font-semibold">{r.title}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Chip tone="outline">{r.affectedService}</Chip>
                    <span>
                      {t('hq.incidents.startedAt')} {agoLabel(minutesAgo(r.startedAt), t)}
                    </span>
                  </p>
                  {r.note && <p className="mt-1 text-sm">{r.note}</p>}
                </div>
                <Badge tone={STATUS_TONE[r.status]}>{t(`hq.incidents.status.${r.status}`)}</Badge>
              </div>

              {r.updates.length > 0 && (
                <ul className="ml-5 flex flex-col gap-1 border-l border-app pl-4 text-xs text-muted">
                  {r.updates.map((u) => (
                    <li key={u.id}>
                      <span className="text-app">{u.note}</span> · {agoLabel(minutesAgo(u.createdAt), t)}
                    </li>
                  ))}
                </ul>
              )}

              {r.status === 'ONGOING' && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <UpdateBox incidentId={r.id} onSent={query.reload} />
                  <Button variant="secondary" onClick={() => resolve(r)}>
                    {t('hq.incidents.resolve')}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </ol>
      )}

      <CreateIncidentSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast(t('hq.incidents.createdOk'), 'success');
          query.reload();
        }}
      />
    </div>
  );
}

function UpdateBox({ incidentId, onSent }: { incidentId: string; onSent: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const text = note.trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.patch(endpoints.admin.incidents.update(incidentId), { note: text }, true);
      setNote('');
      toast(t('hq.incidents.updatedOk'), 'success');
      onSent();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.incidents.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('hq.incidents.updatePlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
        }}
      />
      <Button variant="secondary" onClick={add} disabled={!note.trim()} loading={busy}>
        {t('hq.incidents.addUpdate')}
      </Button>
    </div>
  );
}

function CreateIncidentSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState('');
  const [affectedService, setAffectedService] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('WARNING');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = title.trim().length > 0 && affectedService.trim().length > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.admin.incidents.create,
        { title: title.trim(), severity, affectedService: affectedService.trim(), note: note.trim() || undefined },
        true,
      );
      setTitle('');
      setAffectedService('');
      setSeverity('WARNING');
      setNote('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.incidents.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('hq.incidents.createTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('hq.incidents.formTitle')} htmlFor="inc-title">
          <Input id="inc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('hq.incidents.formTitlePlaceholder')} />
        </Field>
        <Field label={t('hq.incidents.formService')} htmlFor="inc-service">
          <Input id="inc-service" value={affectedService} onChange={(e) => setAffectedService(e.target.value)} placeholder={t('hq.incidents.formServicePlaceholder')} />
        </Field>
        <Field label={t('hq.incidents.formSeverity')}>
          <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                aria-pressed={severity === s}
                className={`px-4 py-1.5 transition-colors ${severity === s ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-[color:var(--surface-soft)]'}`}
              >
                {t(`hq.incidents.severity.${s}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('hq.incidents.formNote')} htmlFor="inc-note">
          <Input id="inc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('hq.incidents.formNotePlaceholder')} />
        </Field>
        {error && <p className="text-sm text-[color:var(--danger)]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('hq.common.cancel')}</Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>{t('hq.incidents.submit')}</Button>
        </div>
      </div>
    </Sheet>
  );
}
