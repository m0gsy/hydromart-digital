'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Wallet } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { CashSettlement, SettlementStatus } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS: Record<SettlementStatus, { label: string; cls: string }> = {
  SUBMITTED: { label: 'Menunggu verifikasi', cls: 'bg-amber-100 text-amber-800' },
  VERIFIED: { label: 'Terverifikasi', cls: 'bg-green-100 text-green-800' },
  DISPUTED: { label: 'Sengketa', cls: 'bg-red-100 text-red-800' },
};

function History() {
  const router = useRouter();
  const load = useAsync<CashSettlement[]>(
    () => api.get(endpoints.deliveries.settlement.history, true),
    [],
  );

  if (load.loading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (load.error) return <div className="p-5"><ErrorState message={load.error} onRetry={load.reload} /></div>;

  const items = load.data ?? [];

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">Riwayat setoran</div>
      </header>

      {items.length === 0 ? (
        <CenterState icon={<Wallet size={32} />} title="Belum ada setoran">
          Setoran tunai COD-mu akan muncul di sini.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((s) => {
            const short = s.variance < 0;
            const badge = STATUS[s.status];
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] tabular-nums text-[color:var(--muted)]">
                    {WHEN.format(new Date(s.createdAt))}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-[color:var(--muted)]">Kamu setor</span>
                  <Money amount={s.depositedAmount} className="font-bold" />
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-[color:var(--muted)]">Total tagihan</span>
                  <Money amount={s.expectedAmount} className="font-bold" />
                </div>
                {s.variance !== 0 && (
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-bold">{short ? 'Kurang' : 'Lebih'}</span>
                    <Money
                      amount={Math.abs(s.variance)}
                      className={`font-extrabold ${short ? 'text-red-600' : 'text-amber-600'}`}
                    />
                  </div>
                )}
                {s.chargedToDriver && (
                  <p className="mt-2 text-[12px] text-red-600">Selisih dibebankan ke kamu.</p>
                )}
                {s.note && <p className="mt-1 text-[12px] text-black/60">Catatan kasir: {s.note}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DriverSettlementHistoryPage() {
  return (
    <DriverShell nav={false}>
      <History />
    </DriverShell>
  );
}
