'use client';

import { useState } from 'react';
import { Lock, Recycle, Plus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canViewReturns, canWriteReturns } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { GallonCondition, GallonReturn, GallonReturnSummary, Page } from '@/lib/types';

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Inline "record return" form. Reloads the ledger + summary on success. */
function RecordForm({ depotId, onSaved }: { depotId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [deposit, setDeposit] = useState('');
  const [condition, setCondition] = useState<GallonCondition>('GOOD');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuantity('');
    setDeposit('');
    setCondition('GOOD');
    setNote('');
    setError(null);
  }

  async function submit() {
    const qty = num(quantity);
    if (qty === null || qty <= 0) {
      setError('Masukkan jumlah galon (lebih dari 0).');
      return;
    }
    const dep = deposit.trim() === '' ? 0 : num(deposit);
    if (dep === null || dep < 0) {
      setError('Deposit harus 0 atau lebih.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.returns.create(depotId),
        { quantity: qty, depositRefunded: dep, condition, note: note || undefined },
        true,
      );
      reset();
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan retur.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" className="mr-1.5" />
        Catat retur
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">Catat retur galon</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jumlah galon" htmlFor="ret-qty">
          <Input
            id="ret-qty"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="mis. 3"
            autoFocus
          />
        </Field>
        <Field label="Deposit dikembalikan (IDR)" htmlFor="ret-dep" hint="Kosong = tanpa deposit.">
          <Input
            id="ret-dep"
            inputMode="numeric"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="mis. 15000"
          />
        </Field>
      </div>
      <Field label="Kondisi" htmlFor="ret-cond">
        <select
          id="ret-cond"
          value={condition}
          onChange={(e) => setCondition(e.target.value as GallonCondition)}
          className="w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium"
        >
          <option value="GOOD">Baik (dipakai ulang)</option>
          <option value="DAMAGED">Rusak</option>
        </select>
      </Field>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" />
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={busy}
        >
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Simpan retur
        </Button>
      </div>
    </Card>
  );
}

function SummaryTiles({ s }: { s: GallonReturnSummary }) {
  const tiles: { label: string; value: string }[] = [
    { label: 'Total retur', value: String(s.returns) },
    { label: 'Galon kembali', value: String(s.gallons) },
    { label: 'Rusak', value: String(s.damaged) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="p-3.5">
          <p className="text-xs text-muted">{t.label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{t.value}</p>
        </Card>
      ))}
      <Card className="p-3.5">
        <p className="text-xs text-muted">Deposit dikembalikan</p>
        <Money amount={s.depositRefunded} className="mt-1 block text-xl font-bold" />
      </Card>
    </div>
  );
}

// ponytail: the design also asks for "galon di pelanggan / belum kembali / deposit
// tertahan" (outstanding). Those need an issued-gallon deposit ledger; the current
// module is a returns-only ledger, so we surface the returned side truthfully rather
// than fabricate outstanding numbers. Drop this note once outstanding is tracked.
function OutstandingNote() {
  return (
    <p className="text-xs text-muted">
      Galon di pelanggan / belum kembali / deposit tertahan belum dilacak — butuh buku besar deposit galon keluar.
    </p>
  );
}

function ReturnRow({ r }: { r: GallonReturn }) {
  return (
    <Card className="flex items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <p className="font-semibold tabular-nums">
          {r.quantity} galon
          {r.condition === 'DAMAGED' && (
            <span className="ml-2">
              <Badge tone="warning">Rusak</Badge>
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {new Date(r.createdAt).toLocaleString('id-ID')}
          {r.note ? ` · ${r.note}` : ''}
        </p>
      </div>
      <Money amount={r.depositRefunded} className="shrink-0 font-semibold" />
    </Card>
  );
}

function ReturnsBody() {
  const { customer } = useAuth();
  const canWrite = canWriteReturns(customer?.role);
  const { scopedId, selected, depots, ready } = useDepot();

  const summary = useAsync<GallonReturnSummary | null>(
    () => (scopedId ? api.get(endpoints.returns.summary(scopedId), true) : Promise.resolve(null)),
    [scopedId],
  );
  const list = useAsync<Page<GallonReturn> | null>(
    () => (scopedId ? api.get(endpoints.returns.list(scopedId, { limit: 50 }), true) : Promise.resolve(null)),
    [scopedId],
  );

  function reload() {
    summary.reload();
    list.reload();
  }

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Recycle size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Retur galon</h1>
        </div>
        {canWrite && scopedId && <RecordForm depotId={scopedId} onSaved={reload} />}
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          Retur untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher).
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<Recycle size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : !scopedId ? (
        <CenterState title="Pilih depot" icon={<Recycle size={40} weight="fill" />}>
          Pilih satu depot dari switcher untuk melihat retur galon.
        </CenterState>
      ) : (
        <>
          {summary.loading ? (
            <Skeleton className="h-20 w-full" />
          ) : summary.data ? (
            <div className="flex flex-col gap-2">
              <SummaryTiles s={summary.data} />
              <OutstandingNote />
            </div>
          ) : null}

          {list.loading ? (
            <Skeleton className="h-64 w-full" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !list.data || list.data.items.length === 0 ? (
            <CenterState title="Belum ada retur" icon={<Recycle size={40} weight="fill" />}>
              Retur galon yang dicatat akan muncul di sini.
            </CenterState>
          ) : (
            <div className="flex flex-col gap-2.5">
              {list.data.items.map((r) => (
                <ReturnRow key={r.id} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewReturns(customer?.role)) {
    return (
      <CenterState title="Khusus staf" icon={<Lock size={40} weight="fill" />}>
        Retur galon tersedia untuk staf depot, head office, dan pemilik waralaba.
      </CenterState>
    );
  }
  return <ReturnsBody />;
}

export default function ReturnsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
