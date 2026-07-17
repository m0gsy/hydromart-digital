'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, ClockCounterClockwise, Wallet } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { CashSettlement, Shift } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function Settlement() {
  const router = useRouter();
  // The next shift to settle = the newest checked-out shift with no settlement yet.
  const load = useAsync<{ shift: Shift | null }>(async () => {
    const [shifts, settled] = await Promise.all([
      api.get<Shift[]>(endpoints.deliveries.shifts.history, true),
      api.get<CashSettlement[]>(endpoints.deliveries.settlement.history, true),
    ]);
    const done = new Set(settled.map((s) => s.shiftId));
    const shift = shifts.find((s) => s.status === 'ENDED' && !done.has(s.id)) ?? null;
    return { shift };
  }, []);

  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CashSettlement | null>(null);

  const deposited = Number(cash) || 0;

  if (load.loading) return <div className="p-5"><Skeleton className="h-72 w-full" /></div>;
  if (load.error || !load.data) {
    return <div className="p-5"><ErrorState message={load.error ?? 'Gagal memuat'} onRetry={load.reload} /></div>;
  }

  const { shift } = load.data;

  const submit = async () => {
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<CashSettlement>(
        endpoints.deliveries.settlement.submit,
        { shiftId: shift.id, depositedAmount: deposited },
        true,
      );
      setDone(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyetor. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">Setoran tunai (COD)</div>
        <button type="button" onClick={() => router.push('/driver/settlement/history')} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]" aria-label="Riwayat setoran">
          <ClockCounterClockwise size={18} />
        </button>
      </header>

      {done ? (
        <SettlementReceipt settlement={done} onDone={() => router.replace('/driver/settlement/history')} />
      ) : !shift ? (
        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <Wallet size={40} className="text-[color:var(--muted)]" />
          <div className="text-base font-extrabold">Tidak ada shift untuk disetor</div>
          <p className="text-sm text-[color:var(--muted)]">
            Selesaikan dan check-out shift dulu. Setoran muncul setelah kamu check-out.
          </p>
          <Button variant="ghost" className="mt-2" onClick={() => router.push('/driver/settlement/history')}>
            Lihat riwayat setoran
          </Button>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="text-sm font-bold">Shift selesai</div>
            <div className="mt-0.5 text-[13px] text-[color:var(--muted)]">
              Check-out {shift.checkOutAt ? WHEN.format(new Date(shift.checkOutAt)) : '—'}
            </div>
            <p className="mt-2 text-[12px] text-black/60">
              Hitung semua uang tunai COD yang kamu kumpulkan shift ini, lalu masukkan jumlah yang kamu setor ke kasir.
            </p>
          </Card>

          <Card className="space-y-3 p-4">
            <Field label="Jumlah disetor ke kasir" htmlFor="cash">
              <Input
                id="cash"
                inputMode="numeric"
                placeholder="0"
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </Field>
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold">Akan disetor</span>
              <Money amount={deposited} className="text-xl font-extrabold text-brand-700" />
            </div>
          </Card>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button loading={busy} disabled={cash === ''} className="w-full" onClick={submit}>
            Setor ke kasir
          </Button>
          <p className="text-center text-[11px] text-[color:var(--muted)]">
            Kasir akan mencocokkan setoranmu dengan total tagihan COD.
          </p>
        </>
      )}
    </div>
  );
}

function SettlementReceipt({
  settlement,
  onDone,
}: {
  settlement: CashSettlement;
  onDone?: () => void;
}) {
  const short = settlement.variance < 0;
  const over = settlement.variance > 0;
  const varianceColor = short ? 'text-red-600' : over ? 'text-amber-600' : 'text-green-600';

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <CheckCircle size={40} weight="fill" className="text-green-600" />
        <div className="text-base font-extrabold">Setoran tercatat</div>
        <div className="text-xs text-[color:var(--muted)]">Menunggu verifikasi kasir</div>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[color:var(--muted)]">Total tagihan COD</span>
          <Money amount={settlement.expectedAmount} className="font-bold" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[color:var(--muted)]">Kamu setor</span>
          <Money amount={settlement.depositedAmount} className="font-bold" />
        </div>
        <div className="flex items-center justify-between border-t border-[color:var(--border)] pt-1.5">
          <span className="font-bold">{short ? 'Kurang' : over ? 'Lebih' : 'Selisih'}</span>
          <Money amount={Math.abs(settlement.variance)} className={`text-lg font-extrabold ${varianceColor}`} />
        </div>
      </div>
      {onDone && (
        <Button variant="ghost" className="mt-1" onClick={onDone}>
          Selesai
        </Button>
      )}
    </Card>
  );
}

export default function DriverSettlementPage() {
  return (
    <DriverShell nav={false}>
      <Settlement />
    </DriverShell>
  );
}
