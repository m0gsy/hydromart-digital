'use client';

import { useState } from 'react';
import { Coins, Lock, Plus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canManageEarningRules } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CourierEarningRule, Depot } from '@/lib/types';

const DATE = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' });

function selectClass() {
  return 'w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ApplyForm({ depots, onSaved }: { depots: Depot[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [depotId, setDepotId] = useState('');
  const [baseFare, setBaseFare] = useState('5000');
  const [peakBonus, setPeakBonus] = useState('2000');
  const [onTimeBonus, setOnTimeBonus] = useState('1000');
  const [peakStartHour, setPeakStartHour] = useState('17');
  const [peakEndHour, setPeakEndHour] = useState('20');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.earningRules.apply,
        {
          depotId: depotId || undefined,
          baseFare: Number(baseFare),
          peakBonus: Number(peakBonus),
          onTimeBonus: Number(onTimeBonus),
          peakStartHour: Number(peakStartHour),
          peakEndHour: Number(peakEndHour),
          effectiveDate,
        },
        true,
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan aturan.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" className="mr-1.5" />
        Aturan baru
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">Terapkan aturan penghasilan baru</p>
      <p className="text-xs text-muted">
        Aturan bersifat efektif-tanggal dan tidak menimpa yang lama — pay pengantaran lampau tetap
        bisa direproduksi.
      </p>
      <Field label="Berlaku untuk" htmlFor="er-depot">
        <select id="er-depot" value={depotId} onChange={(e) => setDepotId(e.target.value)} className={selectClass()}>
          <option value="">Default jaringan (semua depot)</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Ongkos dasar (IDR)" htmlFor="er-base">
          <Input id="er-base" type="number" value={baseFare} onChange={(e) => setBaseFare(e.target.value)} />
        </Field>
        <Field label="Bonus peak (IDR)" htmlFor="er-peak">
          <Input id="er-peak" type="number" value={peakBonus} onChange={(e) => setPeakBonus(e.target.value)} />
        </Field>
        <Field label="Bonus tepat waktu (IDR)" htmlFor="er-ontime">
          <Input id="er-ontime" type="number" value={onTimeBonus} onChange={(e) => setOnTimeBonus(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Peak mulai (jam)" htmlFor="er-start">
          <Input id="er-start" type="number" min={0} max={23} value={peakStartHour} onChange={(e) => setPeakStartHour(e.target.value)} />
        </Field>
        <Field label="Peak selesai (jam)" htmlFor="er-end">
          <Input id="er-end" type="number" min={1} max={24} value={peakEndHour} onChange={(e) => setPeakEndHour(e.target.value)} />
        </Field>
        <Field label="Berlaku sejak" htmlFor="er-date">
          <Input id="er-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Terapkan
        </Button>
      </div>
    </Card>
  );
}

function RuleRow({ r, depotName }: { r: CourierEarningRule; depotName: string }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{depotName}</span>
        <Badge tone={r.depotId ? 'brand' : 'neutral'}>{r.depotId ? 'Depot' : 'Default'}</Badge>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>Dasar <strong className="tabular-nums">{formatIDR(r.baseFare)}</strong></span>
        <span>Peak <strong className="tabular-nums">+{formatIDR(r.peakBonus)}</strong> ({r.peakStartHour}–{r.peakEndHour})</span>
        <span>Tepat waktu <strong className="tabular-nums">+{formatIDR(r.onTimeBonus)}</strong></span>
      </div>
      <p className="text-xs text-muted">Berlaku sejak {DATE.format(new Date(r.effectiveDate))}</p>
    </Card>
  );
}

function Body() {
  const { depots } = useDepot();
  const list = useAsync<CourierEarningRule[]>(() => api.get(endpoints.earningRules.list, true), []);
  const depotName = (id: string | null) => (id ? depots.find((d) => d.id === id)?.name ?? id : 'Default jaringan');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Aturan penghasilan kurir</h1>
        </div>
        <ApplyForm depots={depots} onSaved={list.reload} />
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <CenterState title="Belum ada aturan" icon={<Coins size={40} weight="fill" />}>
          Terapkan aturan pertama — atau biarkan default jaringan bawaan berlaku.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.map((r) => (
            <RuleRow key={r.id} r={r} depotName={depotName(r.depotId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canManageEarningRules(customer?.role)) {
    return (
      <CenterState title="Khusus finance" icon={<Lock size={40} weight="fill" />}>
        Editor aturan penghasilan kurir tersedia untuk finance dan super admin.
      </CenterState>
    );
  }
  return <Body />;
}

export default function EarningRulesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
