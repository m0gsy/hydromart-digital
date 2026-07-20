'use client';

import { useMemo, useState } from 'react';
import { CalendarPlus, Lock, Wrench } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { can } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { MaintenanceItem } from '@/lib/types';

/** Days between now and nextDueAt — drives the SOON "N hari lagi" label. */
function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

type TFn = (k: string, v?: Record<string, string | number>) => string;

/** "Servis tiap N bln"/"N hari" from intervalDays (months when a clean multiple of 30). */
function intervalLabel(days: number, t: TFn): string {
  if (days >= 30 && days % 30 === 0) return t('dashB.maintenance.everyMonths', { n: days / 30 });
  return t('dashB.maintenance.everyDays', { n: days });
}

function StatusBadge({ item }: { item: MaintenanceItem }) {
  const { t } = useT();
  switch (item.status) {
    case 'DUE':
      return <Badge tone="danger">{t('dashB.maintenance.due')}</Badge>;
    case 'SOON':
      return <Badge tone="warning">{t('dashB.maintenance.soon', { n: Math.max(daysUntil(item.nextDueAt), 0) })}</Badge>;
    case 'NEW':
      return <Badge tone="success">{t('dashB.maintenance.new')}</Badge>;
    default:
      return <Badge tone="success">{t('dashB.maintenance.healthy')}</Badge>;
  }
}

function ItemCard({ item, onChanged }: { item: MaintenanceItem; onChanged: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markServiced() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.maintenance.serviced(item.id), {}, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.maintenance.markServicedError'));
      setBusy(false);
    }
  }

  const meta = [
    intervalLabel(item.intervalDays, t),
    item.lastServicedAt ? t('dashB.maintenance.lastServiced', { time: formatDateTime(item.lastServicedAt) }) : null,
    t('dashB.maintenance.next', { time: formatDateTime(item.nextDueAt) }),
  ].filter(Boolean);

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Wrench size={22} weight="fill" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.name}</p>
        <p className="text-[12.5px] text-[color:var(--text-muted)]">
          {item.category} · {meta.join(' · ')}
        </p>
        {error && (
          <p className="mt-1 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusBadge item={item} />
        <Button variant="secondary" onClick={markServiced} loading={busy}>
          {t('dashB.maintenance.markServiced')}
        </Button>
      </div>
    </Card>
  );
}

/** Collapsible "Jadwalkan" create form. */
function CreateForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const [nextDueAt, setNextDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const interval = Number(intervalDays);
    if (!name.trim() || !category.trim() || !interval || !nextDueAt) {
      setError(t('dashB.maintenance.requiredError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.maintenance.create,
        {
          depotId,
          name: name.trim(),
          category: category.trim(),
          intervalDays: interval,
          nextDueAt: new Date(nextDueAt).toISOString(),
        },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.maintenance.scheduleError'));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('dashB.maintenance.scheduleTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dashB.maintenance.nameLabel')} htmlFor="m-name">
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dashB.maintenance.namePlaceholder')} />
        </Field>
        <Field label={t('dashB.maintenance.categoryLabel')} htmlFor="m-cat">
          <Input id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('dashB.maintenance.categoryPlaceholder')} />
        </Field>
        <Field label={t('dashB.maintenance.intervalLabel')} htmlFor="m-int">
          <Input
            id="m-int"
            type="number"
            inputMode="numeric"
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
            placeholder="90"
          />
        </Field>
        <Field label={t('dashB.maintenance.nextLabel')} htmlFor="m-next">
          <Input id="m-next" type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
          {t('dashB.maintenance.saveSchedule')}
        </Button>
      </div>
    </Card>
  );
}

function MaintenanceBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [creating, setCreating] = useState(false);

  const list = useAsync<MaintenanceItem[]>(
    () => (scopedId ? api.get(endpoints.maintenance.list(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );

  const items = useMemo(() => list.data ?? [], [list.data]);
  const dueCount = items.filter((e) => e.status === 'DUE').length;
  const depotName = (selected ?? depots.find((d) => d.id === scopedId))?.name ?? t('dashB.maintenance.depotFallback');

  function afterMutation() {
    setCreating(false);
    list.reload();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashB.maintenance.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {depotName} · <span className="tabular-nums">{dueCount}</span> {t('dashB.maintenance.dueLabel')}
            </p>
          </div>
        </div>
        <Button variant={creating ? 'ghost' : 'primary'} onClick={() => setCreating((v) => !v)}>
          {creating ? (
            t('dashB.maintenance.close')
          ) : (
            <>
              <CalendarPlus size={16} weight="bold" />
              {t('dashB.maintenance.schedule')}
            </>
          )}
        </Button>
      </div>

      {creating && scopedId && <CreateForm depotId={scopedId} onDone={afterMutation} />}

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashB.maintenance.noDepots')} icon={<Wrench size={40} weight="fill" />}>
          {t('dashB.maintenance.noDepotsBody')}
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('dashB.maintenance.noSchedule')} icon={<Wrench size={40} weight="fill" />}>
          {t('dashB.maintenance.noScheduleBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((e) => (
            <ItemCard key={e.id} item={e} onChanged={afterMutation} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotMaintenance', customer?.role)) {
    return (
      <CenterState title={t('dashB.maintenance.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.maintenance.gateBody')}
      </CenterState>
    );
  }
  return <MaintenanceBody />;
}

export default function MaintenancePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
