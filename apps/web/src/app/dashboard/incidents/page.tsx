'use client';

import { useMemo, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
  Drop,
  FirstAidKit,
  Lightning,
  Lock,
  Truck,
  UsersThree,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, Chip, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canViewIncidents } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotIncident, DepotIncidentSeverity, DepotIncidentType } from '@/lib/types';

const TYPE_ICON: Record<DepotIncidentType, Icon> = {
  COURIER_FALL: FirstAidKit,
  VEHICLE_BREAKDOWN: Truck,
  CUSTOMER_CONFLICT: UsersThree,
  POWER_OUTAGE: Lightning,
  GALLON_DAMAGE: Drop,
  OTHER: WarningCircle,
};

const SEVERITY_BADGE: Record<DepotIncidentSeverity, 'danger' | 'warning' | 'neutral'> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

// Left accent by state: resolved is muted; otherwise the severity colour.
function accentClass(incident: DepotIncident): string {
  if (incident.status === 'RESOLVED') return 'border-l-[color:var(--border)]';
  if (incident.severity === 'HIGH') return 'border-l-red-500';
  if (incident.severity === 'MEDIUM') return 'border-l-amber-500';
  return 'border-l-brand-400';
}

function tileClass(incident: DepotIncident): string {
  if (incident.status === 'RESOLVED') return 'bg-[color:var(--surface-muted)] text-[color:var(--text-muted)]';
  if (incident.severity === 'HIGH') return 'bg-red-100 text-red-700';
  if (incident.severity === 'MEDIUM') return 'bg-amber-100 text-amber-700';
  return 'bg-brand-50 text-brand-600';
}

/** Inline resolve form (add note → PATCH resolve, then reload the list). */
function ResolveForm({ incident, onDone }: { incident: DepotIncident; onDone: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (note.trim().length < 3) {
      setError(t('dashB.incidents.noteTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.incidents.resolve(incident.id), { note: note.trim() }, true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.incidents.resolveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-app pt-3">
      <Field label={t('dashB.incidents.noteLabel')} htmlFor={`note-${incident.id}`}>
        <Input
          id={`note-${incident.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('dashB.incidents.notePlaceholder')}
          autoFocus
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          {t('dashB.incidents.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('dashB.incidents.markDone')}
        </Button>
      </div>
    </div>
  );
}

function IncidentCard({ incident, onChanged }: { incident: DepotIncident; onChanged: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const resolved = incident.status === 'RESOLVED';
  const Ic = TYPE_ICON[incident.type];

  // reporter · orderRef · quote · time — join only the parts that exist.
  const meta = [
    incident.courierName,
    incident.orderRef,
    incident.description ? `'${incident.description}'` : null,
    formatDateTime(incident.createdAt),
  ].filter(Boolean);

  return (
    <Card className={`flex flex-col border-l-4 p-4 ${accentClass(incident)}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tileClass(incident)}`}>
          <Ic size={22} weight="fill" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{incident.title}</p>
            {resolved ? (
              <Badge tone="success">{t('dashB.incidents.resolved')}</Badge>
            ) : (
              <Badge tone={SEVERITY_BADGE[incident.severity]}>{t(`dashB.incidents.severity.${incident.severity}`)}</Badge>
            )}
            {incident.status === 'IN_PROGRESS' && <Chip tone="amber">{t('dashB.incidents.inProgress')}</Chip>}
          </div>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
            {t(`dashB.incidents.type.${incident.type}`)} · {meta.join(' · ')}
          </p>
        </div>

        <div className="shrink-0">
          <Button variant={resolved ? 'ghost' : 'secondary'} onClick={() => setOpen((v) => !v)}>
            {resolved ? t('dashB.incidents.detail') : t('dashB.incidents.followUp')}
          </Button>
        </div>
      </div>

      {open && resolved && (
        <div className="mt-3 border-t border-app pt-3 text-sm">
          <p className="text-[color:var(--text-muted)]">
            {incident.resolutionNote ?? t('dashB.incidents.noResolutionNote')}
          </p>
          {incident.resolvedAt && (
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">
              {t('dashB.incidents.resolvedAt', { time: formatDateTime(incident.resolvedAt) })}
            </p>
          )}
        </div>
      )}
      {open && !resolved && <ResolveForm incident={incident} onDone={onChanged} />}
    </Card>
  );
}

type StatusFilter = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

function IncidentsBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [filter, setFilter] = useState<StatusFilter>('ALL');

  // Fetch the depot's incidents once (no status filter) and slice client-side so the
  // chip counts stay accurate regardless of the active filter.
  const list = useAsync<DepotIncident[]>(
    () => (scopedId ? api.get(endpoints.incidents.list({ depotId: scopedId }), true) : Promise.resolve([])),
    [scopedId],
  );

  const all = useMemo(() => list.data ?? [], [list.data]);
  const openCount = all.filter((i) => i.status === 'OPEN').length;
  const inProgressCount = all.filter((i) => i.status === 'IN_PROGRESS').length;
  const unresolved = openCount + inProgressCount;
  const shown = filter === 'ALL' ? all : all.filter((i) => i.status === filter);

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  const CHIPS: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'ALL', label: t('dashB.incidents.chipAll'), count: all.length },
    { key: 'OPEN', label: t('dashB.incidents.chipOpen'), count: openCount },
    { key: 'IN_PROGRESS', label: t('dashB.incidents.chipInProgress'), count: inProgressCount },
    { key: 'RESOLVED', label: t('dashB.incidents.chipResolved') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Warning size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashB.incidents.title')}</h1>
          {scopedDepot && (
            <p className="text-[12.5px] text-[color:var(--text-muted)]">
              {scopedDepot.name} · {t('dashB.incidents.open', { n: unresolved })}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button key={c.key} type="button" onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}>
            <Chip tone={filter === c.key ? 'ink' : 'outline'}>
              {c.label}
              {c.count != null && ` · ${c.count}`}
            </Chip>
          </button>
        ))}
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashB.incidents.noDepots')} icon={<Warning size={40} weight="fill" />}>
          {t('dashB.incidents.noDepotsBody')}
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : shown.length === 0 ? (
        <CenterState title={t('dashB.incidents.noIncidents')} icon={<Warning size={40} weight="fill" />}>
          {filter === 'ALL' ? t('dashB.incidents.emptyAll') : t('dashB.incidents.emptyFilter')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} onChanged={list.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewIncidents(customer?.role)) {
    return (
      <CenterState title={t('dashB.incidents.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.incidents.gateBody')}
      </CenterState>
    );
  }
  return <IncidentsBody />;
}

export default function IncidentsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
