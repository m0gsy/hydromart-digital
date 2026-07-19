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
import { useAsync } from '@/lib/use-async';
import type { MaintenanceItem } from '@/lib/types';

/** Days between now and nextDueAt — drives the SOON "N hari lagi" label. */
function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** "Servis tiap N bln"/"N hari" from intervalDays (months when a clean multiple of 30). */
function intervalLabel(days: number): string {
  if (days >= 30 && days % 30 === 0) return `Servis tiap ${days / 30} bln`;
  return `Servis tiap ${days} hari`;
}

function StatusBadge({ item }: { item: MaintenanceItem }) {
  switch (item.status) {
    case 'DUE':
      return <Badge tone="danger">Jatuh tempo</Badge>;
    case 'SOON':
      return <Badge tone="warning">{Math.max(daysUntil(item.nextDueAt), 0)} hari lagi</Badge>;
    case 'NEW':
      return <Badge tone="success">Baru</Badge>;
    default:
      return <Badge tone="success">Sehat</Badge>;
  }
}

function ItemCard({ item, onChanged }: { item: MaintenanceItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markServiced() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.maintenance.serviced(item.id), {}, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menandai servis.');
      setBusy(false);
    }
  }

  const meta = [
    intervalLabel(item.intervalDays),
    item.lastServicedAt ? `terakhir ${formatDateTime(item.lastServicedAt)}` : null,
    `berikut ${formatDateTime(item.nextDueAt)}`,
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
          Tandai servis
        </Button>
      </div>
    </Card>
  );
}

/** Collapsible "Jadwalkan" create form. */
function CreateForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const [nextDueAt, setNextDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const interval = Number(intervalDays);
    if (!name.trim() || !category.trim() || !interval || !nextDueAt) {
      setError('Nama, kategori, interval, dan tanggal berikutnya wajib diisi.');
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
      setError(err instanceof ApiError ? err.message : 'Gagal menjadwalkan.');
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">Jadwalkan perawatan</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama alat" htmlFor="m-name">
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Filter RO membran" />
        </Field>
        <Field label="Kategori" htmlFor="m-cat">
          <Input id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Filtrasi" />
        </Field>
        <Field label="Interval (hari)" htmlFor="m-int">
          <Input
            id="m-int"
            type="number"
            inputMode="numeric"
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
            placeholder="90"
          />
        </Field>
        <Field label="Servis berikutnya" htmlFor="m-next">
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
          Simpan jadwal
        </Button>
      </div>
    </Card>
  );
}

function MaintenanceBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const [creating, setCreating] = useState(false);

  const list = useAsync<MaintenanceItem[]>(
    () => (scopedId ? api.get(endpoints.maintenance.list(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );

  const items = useMemo(() => list.data ?? [], [list.data]);
  const dueCount = items.filter((e) => e.status === 'DUE').length;
  const depotName = (selected ?? depots.find((d) => d.id === scopedId))?.name ?? 'Depot';

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
            <h1 className="text-2xl font-bold">Perawatan alat</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {depotName} · <span className="tabular-nums">{dueCount}</span> jatuh tempo
            </p>
          </div>
        </div>
        <Button variant={creating ? 'ghost' : 'primary'} onClick={() => setCreating((v) => !v)}>
          {creating ? (
            'Tutup'
          ) : (
            <>
              <CalendarPlus size={16} weight="bold" />
              Jadwalkan
            </>
          )}
        </Button>
      </div>

      {creating && scopedId && <CreateForm depotId={scopedId} onDone={afterMutation} />}

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<Wrench size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title="Belum ada jadwal" icon={<Wrench size={40} weight="fill" />}>
          Depot ini belum punya jadwal perawatan alat.
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
  const { customer } = useAuth();
  if (!can('depotMaintenance', customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Perawatan alat hanya untuk Manajer depot.
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
