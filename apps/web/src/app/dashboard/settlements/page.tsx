'use client';

import { useState } from 'react';
import { Lock, Money, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canVerifySettlement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CashSettlement, SettlementStatus } from '@/lib/types';

const STATUSES: SettlementStatus[] = ['SUBMITTED', 'VERIFIED', 'DISPUTED'];
const STATUS_TONE: Record<SettlementStatus, 'brand' | 'success' | 'danger'> = {
  SUBMITTED: 'brand',
  VERIFIED: 'success',
  DISPUTED: 'danger',
};
const DATE = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function SettlementRow({ s, onDone }: { s: CashSettlement; onDone: () => void }) {
  const [busy, setBusy] = useState<'verify' | 'dispute' | null>(null);
  const [charge, setCharge] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shortfall = s.variance < 0;

  const act = async (kind: 'verify' | 'dispute') => {
    if (kind === 'dispute' && note.trim() === '') {
      setError('Isi alasan sengketa.');
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'verify') {
        await api.post(endpoints.settlements.verify(s.id), { chargedToDriver: shortfall && charge, note: note.trim() || undefined }, true);
      } else {
        await api.post(endpoints.settlements.dispute(s.id), { note: note.trim() }, true);
      }
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold tabular-nums">Disetor {formatIDR(s.depositedAmount)}</p>
          <p className="text-xs text-muted">
            Diharapkan {formatIDR(s.expectedAmount)} · {DATE.format(new Date(s.createdAt))}
          </p>
        </div>
        <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
      </div>

      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${shortfall ? 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]' : 'bg-[color:var(--success-bg)] text-[color:var(--success)]'}`}>
        <Money size={16} weight="fill" />
        {shortfall ? `Kurang ${formatIDR(Math.abs(s.variance))}` : s.variance > 0 ? `Lebih ${formatIDR(s.variance)}` : 'Setoran pas'}
      </div>

      {s.status === 'SUBMITTED' && (
        <>
          {shortfall && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
              Bebankan selisih {formatIDR(Math.abs(s.variance))} ke saldo kurir
            </label>
          )}
          <Field label="Catatan (opsional untuk verifikasi, wajib untuk sengketa)" htmlFor={`note-${s.id}`}>
            <Input id={`note-${s.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. dihitung bersama kasir" />
          </Field>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={() => act('verify')} loading={busy === 'verify'} className="flex-1">
              Verifikasi
            </Button>
            <Button variant="ghost" onClick={() => act('dispute')} loading={busy === 'dispute'} className="flex-1">
              Sengketakan
            </Button>
          </div>
        </>
      )}
      {s.status !== 'SUBMITTED' && s.note && <p className="text-xs text-muted">Catatan: {s.note}</p>}
    </Card>
  );
}

function Body() {
  const { scopedId, selected } = useDepot();
  const [status, setStatus] = useState<SettlementStatus>('SUBMITTED');
  const list = useAsync<CashSettlement[]>(
    () => (scopedId ? api.get(endpoints.settlements.list({ depotId: scopedId, status }), true) : Promise.resolve([])),
    [scopedId, status],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Setoran COD kurir</h1>
      </div>
      <p className="text-sm text-muted">
        {selected ? `Depot ${selected.name}` : 'Menampilkan depot pertama — pilih depot di switcher untuk memverifikasi setoran.'}
      </p>

      <div className="flex items-center gap-2">
        <label htmlFor="s-filter" className="text-sm font-medium text-muted">
          Status
        </label>
        <select
          id="s-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as SettlementStatus)}
          className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm font-medium"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <CenterState title="Tidak ada setoran" icon={<Wallet size={40} weight="fill" />}>
          Belum ada setoran {status.toLowerCase()} untuk depot ini.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.map((s) => (
            <SettlementRow key={s.id} s={s} onDone={list.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canVerifySettlement(customer?.role)) {
    return (
      <CenterState title="Khusus kasir depot" icon={<Lock size={40} weight="fill" />}>
        Verifikasi setoran COD tersedia untuk operator/manajer depot dan finance.
      </CenterState>
    );
  }
  return <Body />;
}

export default function SettlementsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
