'use client';

import { useState } from 'react';
import { Lock, Receipt } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canApproveExpense } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ExpenseClaim, ExpenseClaimStatus, Page } from '@/lib/types';

const STATUSES: ExpenseClaimStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const STATUS_TONE: Record<ExpenseClaimStatus, 'brand' | 'success' | 'danger'> = {
  PENDING: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
};
const CATEGORY_LABELS: Record<string, string> = {
  FUEL: 'Bensin',
  PARKING_TOLL: 'Parkir / tol',
  VEHICLE_REPAIR: 'Servis kendaraan',
  OTHER: 'Lainnya',
};
const DATE = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function ClaimRow({ c, onDone }: { c: ExpenseClaim; onDone: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: 'approve' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      const url = kind === 'approve' ? endpoints.expenseApprovals.approve(c.id) : endpoints.expenseApprovals.reject(c.id);
      await api.post(url, { note: note.trim() || undefined }, true);
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
          <p className="text-sm font-bold tabular-nums">{formatIDR(c.amount)}</p>
          <p className="text-xs font-medium">{CATEGORY_LABELS[c.category] ?? c.category}</p>
          <p className="mt-0.5 text-xs text-muted">
            {c.description} · {DATE.format(new Date(c.createdAt))}
          </p>
        </div>
        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
      </div>

      {c.receiptUrl && (
        <a href={c.receiptUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-600 underline">
          Lihat struk
        </a>
      )}

      {c.status === 'PENDING' ? (
        <>
          <Field label="Catatan reviewer (opsional)" htmlFor={`note-${c.id}`}>
            <Input id={`note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. sesuai bukti" />
          </Field>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={() => act('approve')} loading={busy === 'approve'} className="flex-1">
              Setujui
            </Button>
            <Button variant="danger" onClick={() => act('reject')} loading={busy === 'reject'} className="flex-1">
              Tolak
            </Button>
          </div>
        </>
      ) : (
        c.reviewNote && <p className="text-xs text-muted">Catatan: {c.reviewNote}</p>
      )}
    </Card>
  );
}

function Body() {
  const { scopedId, selected } = useDepot();
  const [status, setStatus] = useState<ExpenseClaimStatus>('PENDING');
  const list = useAsync<Page<ExpenseClaim>>(
    () => api.get(endpoints.expenseApprovals.list({ depotId: scopedId ?? undefined, status, limit: 100 }), true),
    [scopedId, status],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Receipt size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Klaim pengeluaran kurir</h1>
      </div>
      <p className="text-sm text-muted">
        {selected ? `Depot ${selected.name}` : 'Semua depot — pilih depot di switcher untuk menyaring.'}
      </p>

      <div className="flex items-center gap-2">
        <label htmlFor="c-filter" className="text-sm font-medium text-muted">
          Status
        </label>
        <select
          id="c-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as ExpenseClaimStatus)}
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
      ) : !list.data || list.data.items.length === 0 ? (
        <CenterState title="Tidak ada klaim" icon={<Receipt size={40} weight="fill" />}>
          Belum ada klaim {status.toLowerCase()}.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.items.map((c) => (
            <ClaimRow key={c.id} c={c} onDone={list.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canApproveExpense(customer?.role)) {
    return (
      <CenterState title="Khusus manajer / finance" icon={<Lock size={40} weight="fill" />}>
        Persetujuan klaim pengeluaran tersedia untuk manajer depot dan finance.
      </CenterState>
    );
  }
  return <Body />;
}

export default function ExpenseClaimsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
