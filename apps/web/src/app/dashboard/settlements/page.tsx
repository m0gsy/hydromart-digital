'use client';

import { useState } from 'react';
import { CaretDown, Lock, Money, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canVerifySettlement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CashSettlement, SettlementStatus } from '@/lib/types';

const STATUSES: SettlementStatus[] = ['SUBMITTED', 'VERIFIED', 'DISPUTED'];
const STATUS_LABEL: Record<SettlementStatus, string> = {
  SUBMITTED: 'Menunggu',
  VERIFIED: 'Terverifikasi',
  DISPUTED: 'Sengketa',
};
const TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' });

const shortId = (id: string) => id.slice(0, 8);
const initials = (id: string) => id.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();

function SettlementRow({ s, onDone }: { s: CashSettlement; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'verify' | 'dispute' | null>(null);
  const [charge, setCharge] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pending = s.status === 'SUBMITTED';
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
    <Card
      className={`flex flex-col gap-3 p-4 ${pending ? 'border-[color:var(--warning)] bg-[color:var(--warning-bg)]' : ''}`}
    >
      {/* Identity + wajib-setor */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
          >
            {initials(s.driverId)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">Kurir {shortId(s.driverId)}</p>
            <p className="text-xs text-[color:var(--text-muted)]">
              {s.orderIds.length} pesanan COD · setor {TIME.format(new Date(s.createdAt))}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-[color:var(--text-muted)]">Wajib setor</p>
          <p className="flex items-center justify-end gap-1 text-sm font-bold tabular-nums">
            <Money size={14} weight="fill" />
            {formatIDR(s.expectedAmount)}
          </p>
        </div>
      </div>

      {/* Pending → verify trigger + inline flow */}
      {pending ? (
        <>
          {!open ? (
            <Button onClick={() => setOpen(true)} className="w-full">
              Hitung &amp; verifikasi
            </Button>
          ) : (
            <div className="flex flex-col gap-3 border-t border-app pt-3">
              <div
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${
                  shortfall
                    ? 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                    : 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                }`}
              >
                <Money size={16} weight="fill" />
                <span className="tabular-nums">
                  Disetor {formatIDR(s.depositedAmount)}
                  {' · '}
                  {shortfall
                    ? `kurang ${formatIDR(Math.abs(s.variance))}`
                    : s.variance > 0
                      ? `lebih ${formatIDR(s.variance)}`
                      : 'pas'}
                </span>
              </div>

              {shortfall && (
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
                  Bebankan selisih {formatIDR(Math.abs(s.variance))} ke saldo kurir
                </label>
              )}
              <Field label="Catatan (opsional untuk verifikasi, wajib untuk sengketa)" htmlFor={`note-${s.id}`}>
                <Input id={`note-${s.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. dihitung bersama kasir" />
              </Field>
              {error && <p className="text-sm font-medium text-[color:var(--danger)]">{error}</p>}
              <div className="flex gap-2">
                <Button onClick={() => act('verify')} loading={busy === 'verify'} className="flex-1">
                  Verifikasi
                </Button>
                <Button variant="ghost" onClick={() => act('dispute')} loading={busy === 'dispute'} className="flex-1">
                  Sengketakan
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Verified / disputed → status chip + disetor + rincian */
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  s.status === 'VERIFIED'
                    ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                    : 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                }`}
              >
                {STATUS_LABEL[s.status]}
              </span>
              <span className="text-sm font-bold tabular-nums">Disetor {formatIDR(s.depositedAmount)}</span>
              {shortfall && (
                <span className="text-sm font-bold tabular-nums text-[color:var(--danger)]">
                  Kurang {formatIDR(Math.abs(s.variance))}
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={() => setOpen((v) => !v)} className="px-3 py-1.5 text-xs">
              Rincian
              <CaretDown size={12} weight="bold" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </Button>
          </div>
          {open && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-app pt-2 text-xs">
              <dt className="text-[color:var(--text-muted)]">Wajib setor</dt>
              <dd className="text-right font-medium tabular-nums">{formatIDR(s.expectedAmount)}</dd>
              <dt className="text-[color:var(--text-muted)]">Disetor</dt>
              <dd className="text-right font-medium tabular-nums">{formatIDR(s.depositedAmount)}</dd>
              <dt className="text-[color:var(--text-muted)]">Selisih</dt>
              <dd className="text-right font-medium tabular-nums">{formatIDR(s.variance)}</dd>
              {shortfall && (
                <>
                  <dt className="text-[color:var(--text-muted)]">Dibebankan ke kurir</dt>
                  <dd className="text-right font-medium">{s.chargedToDriver ? 'Ya' : 'Tidak'}</dd>
                </>
              )}
              {s.note && (
                <>
                  <dt className="text-[color:var(--text-muted)]">Catatan</dt>
                  <dd className="text-right font-medium">{s.note}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
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

  const waiting = list.data?.filter((s) => s.status === 'SUBMITTED').length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Wallet size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Verifikasi setoran COD</h1>
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          Shift {DAY.format(new Date())} · {waiting} setoran menunggu
        </p>
        <p className="text-sm text-[color:var(--text-muted)]">
          {selected ? `Depot ${selected.name}` : 'Menampilkan depot pertama — pilih depot di switcher untuk memverifikasi setoran.'}
        </p>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="s-filter" className="text-sm font-medium text-[color:var(--text-muted)]">
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
              {STATUS_LABEL[s]}
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
          Belum ada setoran {STATUS_LABEL[status].toLowerCase()} untuk depot ini.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.map((s) => (
            <SettlementRow key={s.id} s={s} onDone={list.reload} />
          ))}
        </div>
      )}

      <Card className="bg-brand-50 p-4 text-sm text-[color:var(--text-muted)]" elevated={false}>
        Verifikasi mencocokkan tunai fisik dengan total COD kurir. Selisih tercatat sebagai tanggungan kurir &amp; muncul di
        riwayat setoran app kurir.
      </Card>
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
