'use client';

import { useMemo, useState } from 'react';
import { ArrowsClockwise, Info, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Button,
  Card,
  CenterState,
  Chip,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotSubscription, DepotSubscriptionCadence } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

const CADENCE_LABEL: Record<DepotSubscriptionCadence, string> = {
  DAILY: 'Tiap hari',
  EVERY_3_DAYS: 'Tiap 3 hari',
  WEEKLY: 'Tiap minggu',
  BIWEEKLY: 'Tiap 2 minggu',
  MONTHLY: 'Tiap bulan',
};

const CADENCES = Object.keys(CADENCE_LABEL) as DepotSubscriptionCadence[];

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4 text-center">
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-[color:var(--text-muted)]">{label}</p>
    </Card>
  );
}

/** Create a standing order. POSTs then reloads the roster. */
function CreateForm({ depotId, onCreated }: { depotId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cadence, setCadence] = useState<DepotSubscriptionCadence>('WEEKLY');
  const [nextRunAt, setNextRunAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCustomerName('');
    setProductLabel('');
    setQuantity('');
    setCadence('WEEKLY');
    setNextRunAt('');
    setNote('');
    setError(null);
  }

  async function submit() {
    const qty = Number(quantity);
    if (!customerName.trim() || !productLabel.trim() || !Number.isFinite(qty) || qty < 1) {
      setError('Isi nama pelanggan, produk, dan jumlah galon (≥1).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.depotSubscriptions.create,
        {
          depotId,
          customerName: customerName.trim(),
          productLabel: productLabel.trim(),
          quantity: qty,
          cadence,
          nextRunAt: nextRunAt || undefined,
          note: note.trim() || undefined,
        },
        true,
      );
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat langganan.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Langganan baru</Button>;
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">Langganan baru</h2>
      <div className="flex flex-wrap gap-3">
        <Field label="Nama pelanggan" htmlFor="s-name">
          <Input id="s-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Siti Rahayu" />
        </Field>
        <Field label="Produk" htmlFor="s-prod">
          <Input id="s-prod" value={productLabel} onChange={(e) => setProductLabel(e.target.value)} placeholder="Galon 19L" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="Jumlah galon" htmlFor="s-qty">
          <Input
            id="s-qty"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="2"
          />
        </Field>
        <Field label="Frekuensi" htmlFor="s-cad">
          <select
            id="s-cad"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as DepotSubscriptionCadence)}
            className={`${inputClass} min-w-40`}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jalan berikutnya" htmlFor="s-next">
          <Input id="s-next" type="date" value={nextRunAt} onChange={(e) => setNextRunAt(e.target.value)} />
        </Field>
      </div>
      <Field label="Catatan" htmlFor="s-note">
        <Input id="s-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. antar sebelum jam 9 pagi" />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
        >
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}

function SubRow({ sub, onChanged }: { sub: DepotSubscription; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const url =
        sub.status === 'ACTIVE'
          ? endpoints.depotSubscriptions.pause(sub.id)
          : endpoints.depotSubscriptions.resume(sub.id);
      await api.patch(url, undefined, true);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const sublabel = [
    CADENCE_LABEL[sub.cadence],
    sub.nextRunAt ? `berikutnya ${formatDateTime(sub.nextRunAt)}` : 'belum dijadwalkan',
  ].join(' · ');

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
        {sub.customerName.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {sub.customerName} · <span className="tabular-nums">{sub.quantity}</span> galon
        </p>
        <p className="text-[12.5px] text-[color:var(--text-muted)]">{sublabel}</p>
      </div>
      {sub.status === 'ACTIVE' && <Chip tone="success">Auto-order</Chip>}
      {sub.status === 'PAUSED' && <Chip tone="amber">Dijeda</Chip>}
      {sub.status === 'CANCELLED' && <Chip tone="outline">Dibatalkan</Chip>}
      {sub.status === 'ACTIVE' && (
        <Button variant="secondary" onClick={toggle} loading={busy}>
          Jeda
        </Button>
      )}
      {sub.status === 'PAUSED' && (
        <Button variant="secondary" onClick={toggle} loading={busy}>
          Lanjutkan
        </Button>
      )}
    </Card>
  );
}

function SubscriptionsBody() {
  const { scopedId, selected, depots, ready } = useDepot();

  const list = useAsync<DepotSubscription[]>(
    () =>
      scopedId
        ? api.get(endpoints.depotSubscriptions.list({ depotId: scopedId }), true)
        : Promise.resolve([]),
    [scopedId],
  );

  const subs = useMemo(() => list.data ?? [], [list.data]);
  const activeCount = subs.filter((s) => s.status === 'ACTIVE').length;
  const pausedCount = subs.filter((s) => s.status === 'PAUSED').length;
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowsClockwise size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Langganan</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}
              <span className="tabular-nums">{activeCount}</span> aktif ·{' '}
              <span className="tabular-nums">{pausedCount}</span> dijeda
            </p>
          </div>
        </div>
        {scopedId && <CreateForm depotId={scopedId} onCreated={list.reload} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Aktif" value={activeCount} />
        <Stat label="Dijeda" value={pausedCount} />
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<ArrowsClockwise size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-56 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : subs.length === 0 ? (
        <CenterState title="Belum ada langganan" icon={<ArrowsClockwise size={40} weight="fill" />}>
          Depot ini belum punya langganan berjalan. Tambahkan yang pertama.
        </CenterState>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-[color:var(--text-muted)]">Langganan berjalan</h2>
          {subs.map((s) => (
            <SubRow key={s.id} sub={s} onChanged={list.reload} />
          ))}
        </section>
      )}

      <Card className="flex items-start gap-3 bg-brand-50 p-4" elevated={false}>
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-[12.5px] text-[color:var(--text)]">
          Pesanan langganan dibuat otomatis pada pagi hari jadwal dan langsung masuk antrean
          pengiriman. Pelanggan bisa menjeda kapan saja lewat aplikasi.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!can('depotSubscriptions', customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Langganan pelanggan hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <SubscriptionsBody />;
}

export default function SubscriptionsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
