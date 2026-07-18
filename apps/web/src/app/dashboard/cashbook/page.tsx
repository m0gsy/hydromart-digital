'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Export, Lock, Plus, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
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
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CashDirection, CashbookResponse } from '@/lib/types';

const TODAY = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(
  new Date(),
);
const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const startOfTodayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

function StatCard({
  label,
  amount,
  variant,
}: {
  label: string;
  amount: number;
  variant: 'in' | 'out' | 'balance';
}) {
  if (variant === 'balance') {
    return (
      <Card className="flex flex-col gap-1 bg-brand-700 p-4 text-on-brand" elevated={false}>
        <p className="text-xs font-medium opacity-80">{label}</p>
        <Money amount={amount} className="text-lg font-extrabold" />
      </Card>
    );
  }
  const color = variant === 'in' ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]';
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-[color:var(--text-muted)]">{label}</p>
      <span className={`text-lg font-extrabold tabular-nums ${color}`}>
        {variant === 'in' ? '+' : '−'}
        <Money amount={amount} />
      </span>
    </Card>
  );
}

/** Inline "Catat kas" form → POST an entry, then reload the ledger. */
function CreateForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const [direction, setDirection] = useState<CashDirection>('IN');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountIdr = Number(amount);
    if (!category.trim() || !label.trim() || !Number.isFinite(amountIdr) || amountIdr <= 0) {
      setError('Isi kategori, keterangan, dan nominal (> 0).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.cashbook.create,
        { depotId, direction, category: category.trim(), label: label.trim(), amountIdr },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mencatat kas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex gap-2">
        {(['IN', 'OUT'] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDirection(d)} aria-pressed={direction === d}>
            <Chip tone={direction === d ? 'ink' : 'outline'}>{d === 'IN' ? 'Masuk' : 'Keluar'}</Chip>
          </button>
        ))}
      </div>
      <Field label="Kategori" htmlFor="cb-category">
        <Input
          id="cb-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="mis. Penjualan, Belanja"
        />
      </Field>
      <Field label="Keterangan" htmlFor="cb-label">
        <Input
          id="cb-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="mis. Penjualan galon tunai"
        />
      </Field>
      <Field label="Nominal (Rp)" htmlFor="cb-amount">
        <Input
          id="cb-amount"
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}

function CashbookBody() {
  const { scopedId } = useDepot();
  const [showForm, setShowForm] = useState(false);

  const book = useAsync<CashbookResponse>(
    () =>
      scopedId
        ? api.get(endpoints.cashbook.list({ depotId: scopedId, from: startOfTodayIso() }), true)
        : Promise.resolve({ entries: [], summary: { inIdr: 0, outIdr: 0, netIdr: 0 } }),
    [scopedId],
  );

  const summary = book.data?.summary ?? { inIdr: 0, outIdr: 0, netIdr: 0 };
  // Newest first — server order isn't guaranteed, sort by occurredAt desc.
  const entries = [...(book.data?.entries ?? [])].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Buku kas</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{TODAY}</p>
          </div>
        </div>
        <Chip tone="tint">Hari ini</Chip>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Masuk" amount={summary.inIdr} variant="in" />
        <StatCard label="Keluar" amount={summary.outIdr} variant="out" />
        {/* ponytail: opening balance not tracked server-side, so this is net today (in − out), not a running balance. */}
        <StatCard label="Kas bersih" amount={summary.netIdr} variant="balance" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Transaksi hari ini</p>
        <Button variant="secondary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} weight="bold" />
          Catat kas
        </Button>
      </div>

      {showForm && scopedId && (
        <CreateForm
          depotId={scopedId}
          onDone={() => {
            setShowForm(false);
            book.reload();
          }}
        />
      )}

      {book.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : book.error ? (
        <ErrorState message={book.error} onRetry={book.reload} />
      ) : entries.length === 0 ? (
        <CenterState title="Belum ada transaksi" icon={<BookOpen size={40} weight="fill" />}>
          Belum ada kas masuk atau keluar yang tercatat hari ini.
        </CenterState>
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {entries.map((e) => {
            const isIn = e.direction === 'IN';
            const ArrowIcon: Icon = isIn ? ArrowDown : ArrowUp;
            return (
              <div key={e.id} className="flex items-center gap-3 p-4">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                    isIn
                      ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                      : 'bg-[color:var(--surface-soft)] text-[color:var(--danger)]'
                  }`}
                >
                  <ArrowIcon size={16} weight="bold" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-xs text-[color:var(--text-muted)]">
                    {timeFmt.format(new Date(e.occurredAt))} · {e.category}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    isIn ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'
                  }`}
                >
                  {isIn ? '+' : '−'}
                  <Money amount={e.amountIdr} />
                </span>
              </div>
            );
          })}
        </Card>
      )}

      {/* ponytail: export + close-book are static no-ops until those flows are specced. */}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1">
          <Export size={16} weight="bold" />
          Ekspor CSV
        </Button>
        <Button className="flex-1">Tutup buku hari ini</Button>
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!can('depotFinance', customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Buku kas depot hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <CashbookBody />;
}

export default function CashbookPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
