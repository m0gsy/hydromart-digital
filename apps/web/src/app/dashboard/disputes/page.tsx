'use client';

import { useMemo, useState } from 'react';
import { Lock, Scales } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  Chip,
  ErrorState,
  Field,
  Input,
  Money,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { can } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

const CATEGORY_LABEL: Record<DisputeCategory, string> = {
  WRONG_ITEM: 'Salah item',
  NOT_RECEIVED: 'Tidak diterima',
  OVERCHARGED: 'Lebih bayar',
  QUALITY: 'Kualitas',
  OTHER: 'Lainnya',
};

const STATUS_LABEL: Record<DisputeStatus, string> = {
  OPEN: 'Terbuka',
  RESOLVED: 'Selesai',
  REJECTED: 'Ditolak',
};

const STATUS_BADGE: Record<DisputeStatus, 'warning' | 'success' | 'neutral'> = {
  OPEN: 'warning',
  RESOLVED: 'success',
  REJECTED: 'neutral',
};

const RESOLUTION_LABEL: Record<DisputeResolution, string> = {
  REFUND: 'Refund',
  RESEND: 'Kirim ulang',
  REJECTED: 'Ditolak',
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** OPEN dispute resolution panel: optional note + three resolution actions. */
function ResolvePanel({ dispute, onDone }: { dispute: OrderDispute; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<DisputeResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: DisputeResolution) {
    setBusy(resolution);
    setError(null);
    try {
      await api.patch(
        endpoints.disputes.resolve(dispute.id),
        { resolution, resolutionNote: note.trim() || undefined },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyelesaikan sengketa.');
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-app pt-3">
      <Field label="Catatan (opsional)" htmlFor={`note-${dispute.id}`}>
        <Input
          id={`note-${dispute.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="mis. Sudah dihubungi, refund diproses"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="flex-1"
          loading={busy === 'REFUND'}
          disabled={busy != null}
          onClick={() => resolve('REFUND')}
        >
          Refund ({formatIDR(dispute.amountIdr)})
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          loading={busy === 'RESEND'}
          disabled={busy != null}
          onClick={() => resolve('RESEND')}
        >
          Kirim ulang
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          loading={busy === 'REJECTED'}
          disabled={busy != null}
          onClick={() => resolve('REJECTED')}
        >
          Tolak
        </Button>
      </div>
    </div>
  );
}

function DisputeCard({ dispute, onChanged }: { dispute: OrderDispute; onChanged: () => void }) {
  const open = dispute.status === 'OPEN';
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold">{dispute.orderRef}</p>
            <Chip tone="outline">{CATEGORY_LABEL[dispute.category]}</Chip>
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">
            {dispute.customerName} · {formatDateTime(dispute.createdAt)}
          </p>
        </div>
        <Badge tone={STATUS_BADGE[dispute.status]}>{STATUS_LABEL[dispute.status]}</Badge>
      </div>

      <p className="rounded-lg bg-[color:var(--surface-soft)] p-3 text-[12.5px] italic text-[color:var(--text-muted)]">
        “{dispute.description}”
      </p>

      <dl className="flex flex-col divide-y divide-[color:var(--border)] rounded-lg border border-app px-3">
        <Fact label="Nilai">
          <Money amount={dispute.amountIdr} />
        </Fact>
        <Fact label="Kurir">{dispute.courierName ?? '—'}</Fact>
      </dl>

      {open ? (
        <ResolvePanel dispute={dispute} onDone={onChanged} />
      ) : (
        <p className="border-t border-app pt-3 text-xs font-medium text-[color:var(--text-muted)]">
          {dispute.resolution ? `${RESOLUTION_LABEL[dispute.resolution]} · ` : ''}
          {dispute.resolutionNote || 'Sengketa sudah diselesaikan.'}
        </p>
      )}
    </Card>
  );
}

/** Collapsible "Catat sengketa" create form. */
function CreateForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const [orderRef, setOrderRef] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [category, setCategory] = useState<DisputeCategory>('NOT_RECEIVED');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [courierName, setCourierName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!orderRef.trim() || !customerName.trim() || !description.trim()) {
      setError('Nomor order, nama pelanggan, dan keterangan wajib diisi.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.disputes.create,
        {
          depotId,
          orderRef: orderRef.trim(),
          customerName: customerName.trim(),
          category,
          description: description.trim(),
          amountIdr: amount ? Number(amount) : undefined,
          courierName: courierName.trim() || undefined,
        },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mencatat sengketa.');
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">Catat sengketa</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nomor order" htmlFor="d-ref">
          <Input id="d-ref" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="ORD-2418" />
        </Field>
        <Field label="Nama pelanggan" htmlFor="d-cust">
          <Input
            id="d-cust"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Rina Hapsari"
          />
        </Field>
        <Field label="Kategori" htmlFor="d-cat">
          <select
            id="d-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as DisputeCategory)}
            className={inputClass}
          >
            {(Object.keys(CATEGORY_LABEL) as DisputeCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nilai (Rp, opsional)" htmlFor="d-amt">
          <Input
            id="d-amt"
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="42000"
          />
        </Field>
        <Field label="Kurir (opsional)" htmlFor="d-cour">
          <Input
            id="d-cour"
            value={courierName}
            onChange={(e) => setCourierName(e.target.value)}
            placeholder="Budi Santoso"
          />
        </Field>
      </div>
      <Field label="Keterangan" htmlFor="d-desc">
        <textarea
          id="d-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Ringkasan keluhan pelanggan"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
          Simpan sengketa
        </Button>
      </div>
    </Card>
  );
}

type StatusFilter = 'ALL' | DisputeStatus;

function DisputesBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [creating, setCreating] = useState(false);

  const list = useAsync<OrderDispute[]>(
    () => (scopedId ? api.get(endpoints.disputes.list({ depotId: scopedId }), true) : Promise.resolve([])),
    [scopedId],
  );

  const all = useMemo(() => list.data ?? [], [list.data]);
  const openCount = all.filter((d) => d.status === 'OPEN').length;
  const shown = filter === 'ALL' ? all : all.filter((d) => d.status === filter);
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  const CHIPS: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'ALL', label: 'Semua', count: all.length },
    { key: 'OPEN', label: 'Terbuka', count: openCount },
    { key: 'RESOLVED', label: 'Selesai' },
    { key: 'REJECTED', label: 'Ditolak' },
  ];

  function afterMutation() {
    setCreating(false);
    list.reload();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scales size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Sengketa order</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}
              {openCount} terbuka · klaim pelanggan
            </p>
          </div>
        </div>
        <Button variant={creating ? 'ghost' : 'secondary'} onClick={() => setCreating((v) => !v)}>
          {creating ? 'Tutup' : 'Catat sengketa'}
        </Button>
      </div>

      {creating && scopedId && <CreateForm depotId={scopedId} onDone={afterMutation} />}

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
        <CenterState title="Belum ada depot" icon={<Scales size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : shown.length === 0 ? (
        <CenterState title="Tidak ada sengketa" icon={<Scales size={40} weight="fill" />}>
          {filter === 'ALL' ? 'Depot ini belum punya catatan sengketa.' : 'Tidak ada sengketa untuk filter ini.'}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((d) => (
            <DisputeCard key={d.id} dispute={d} onChanged={afterMutation} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!can('depotDisputes', customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Sengketa order hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <DisputesBody />;
}

export default function DisputesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
