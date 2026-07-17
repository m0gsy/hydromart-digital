'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Receipt } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { ExpenseCategory, ExpenseClaim, ExpenseClaimStatus, Page } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'FUEL', label: 'Bensin' },
  { value: 'PARKING_TOLL', label: 'Parkir / tol' },
  { value: 'VEHICLE_REPAIR', label: 'Servis kendaraan' },
  { value: 'OTHER', label: 'Lainnya' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])) as Record<ExpenseCategory, string>;

const STATUS: Record<ExpenseClaimStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Menunggu', tone: 'text-amber-600' },
  APPROVED: { label: 'Disetujui', tone: 'text-green-600' },
  REJECTED: { label: 'Ditolak', tone: 'text-red-600' },
};

function Expenses() {
  const router = useRouter();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? null;

  const load = useAsync<Page<ExpenseClaim>>(
    () => api.get(endpoints.courierPayout.expenses, true),
    [],
  );

  const [category, setCategory] = useState<ExpenseCategory>('FUEL');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const want = Number(amount) || 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.courierPayout.expenses,
        { category, amount: want, description: desc.trim(), depotId: depotId ?? undefined },
        true,
      );
      setAmount('');
      setDesc('');
      await load.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengirim klaim. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const claims = load.data?.items ?? [];

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">Klaim pengeluaran</div>
      </header>

      <Card className="space-y-3 p-4">
        <Field label="Jenis pengeluaran" htmlFor="category">
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`rounded-xl border p-2.5 text-sm font-bold ${
                  category === c.value
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-[color:var(--border)]'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Jumlah" htmlFor="amount">
          <Input
            id="amount"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          />
        </Field>
        <Field label="Keterangan" htmlFor="desc">
          <Input
            id="desc"
            placeholder="Contoh: bensin shift pagi"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={280}
          />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button loading={busy} disabled={want <= 0 || desc.trim() === ''} className="w-full" onClick={submit}>
          Kirim klaim
        </Button>
        <p className="text-center text-[11px] text-[color:var(--muted)]">
          Klaim kecil disetujui otomatis; sisanya menunggu persetujuan depot.
        </p>
      </Card>

      <div className="text-sm font-extrabold">Riwayat klaim</div>
      {load.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : load.error ? (
        <ErrorState message={load.error} onRetry={load.reload} />
      ) : claims.length === 0 ? (
        <CenterState icon={<Receipt size={32} />} title="Belum ada klaim">
          Klaim pengeluaran yang kamu kirim akan muncul di sini.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2">
          {claims.map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{CATEGORY_LABEL[c.category]}</div>
                <div className="truncate text-[12px] text-[color:var(--muted)]">{c.description}</div>
                <div className="text-[11px] tabular-nums text-[color:var(--muted)]">
                  {WHEN.format(new Date(c.createdAt))} · <span className={STATUS[c.status].tone}>{STATUS[c.status].label}</span>
                </div>
              </div>
              <Money amount={c.amount} className="shrink-0 text-sm font-extrabold" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DriverExpensesPage() {
  return (
    <DriverShell nav={false}>
      <Expenses />
    </DriverShell>
  );
}
