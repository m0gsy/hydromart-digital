'use client';

import { useMemo } from 'react';
import { Lock, Info, Wallet, CheckCircle, Warning, LinkSimple } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { PaymentMethod, UnsettledMethodBucket } from '@/lib/types';

// Reconciliation rows are local — no per-payment matching feed exists yet.
// TODO: wire to payment-service reconciliation backend.
type ReconStatus = 'MATCHED' | 'UNMATCHED' | 'PENDING';
interface ReconRow {
  id: string;
  ref: string;
  method: 'COD' | 'QRIS' | 'Transfer';
  amount: number;
  status: ReconStatus;
}

const RECON_ROWS: ReconRow[] = [
  { id: 'r1', ref: 'ORD-0142 · Budi', method: 'COD', amount: 57000, status: 'MATCHED' },
  { id: 'r2', ref: 'ORD-0143 · Siti', method: 'QRIS', amount: 38000, status: 'MATCHED' },
  { id: 'r3', ref: 'TRF-8891 · BCA', method: 'Transfer', amount: 114000, status: 'UNMATCHED' },
  { id: 'r4', ref: 'ORD-0145 · Toko Jaya', method: 'QRIS', amount: 96000, status: 'PENDING' },
];

function methodTotal(rows: UnsettledMethodBucket[], method: PaymentMethod): number {
  return rows.filter((r) => r.method === method).reduce((n, r) => n + r.amount, 0);
}

function MethodCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {loading ? (
        <p className="text-2xl font-bold text-muted">…</p>
      ) : (
        <Money amount={value} className="text-2xl font-bold" />
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: ReconStatus }) {
  if (status === 'MATCHED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--success)]">
        <CheckCircle size={14} weight="fill" /> Cocok
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--warning)]">
        <Warning size={14} weight="fill" /> menunggu callback
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--danger)]">
      <Warning size={14} weight="fill" /> Belum cocok
    </span>
  );
}

function ReconRowItem({ row }: { row: ReconRow }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-app py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{row.ref}</p>
        <p className="text-xs text-muted">{row.method}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <Money amount={row.amount} className="font-semibold" />
          <div className="mt-0.5">
            <StatusBadge status={row.status} />
          </div>
        </div>
        {row.status === 'UNMATCHED' && (
          <Button variant="secondary" className="shrink-0">
            <LinkSimple size={14} /> Tautkan
          </Button>
        )}
      </div>
    </div>
  );
}

function PaymentReconBody() {
  const today = useMemo(
    () => new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    [],
  );
  // REAL — network revenue by method (payment-service). Falls back to 0 while loading /
  // if the role is not permitted to read the HQ aggregate.
  const methods = useAsync<UnsettledMethodBucket[]>(
    () => api.get<UnsettledMethodBucket[]>(endpoints.payments.revenueByMethod(), true),
    [],
  );
  const rows = methods.data ?? [];
  const unmatched = RECON_ROWS.filter((r) => r.status !== 'MATCHED').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Rekonsiliasi pembayaran</h1>
          <p className="text-sm text-muted tabular-nums">
            {today} · {unmatched} belum cocok
          </p>
        </div>
      </div>

      {methods.error && !methods.loading ? (
        <ErrorState message={methods.error} onRetry={methods.reload} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MethodCard label="COD" value={methodTotal(rows, 'CASH')} loading={methods.loading} />
        <MethodCard label="QRIS" value={methodTotal(rows, 'QRIS')} loading={methods.loading} />
        <MethodCard label="Transfer" value={methodTotal(rows, 'TRANSFER')} loading={methods.loading} />
      </div>

      <Card className="flex flex-col p-5">
        <h2 className="mb-1 font-semibold">Daftar transaksi</h2>
        <div className="flex flex-col">
          {RECON_ROWS.map((r) => (
            <ReconRowItem key={r.id} row={r} />
          ))}
        </div>
      </Card>

      <Card className="flex gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-sm text-muted">
          Transfer yang belum cocok perlu ditautkan manual ke pesanannya. QRIS menunggu callback
          dari penyedia pembayaran dan akan cocok otomatis begitu dana masuk.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Manajer depot saja" icon={<Lock size={40} weight="fill" />}>
        Rekonsiliasi pembayaran hanya untuk manajer depot.
      </CenterState>
    );
  }
  return <PaymentReconBody />;
}

export default function PaymentReconPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
