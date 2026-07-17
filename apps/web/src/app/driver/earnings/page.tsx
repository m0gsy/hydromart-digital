'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Coins, TrendUp } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { CourierEarningsSummary, CourierLedgerEntry } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function Earnings() {
  const router = useRouter();
  const load = useAsync<CourierEarningsSummary>(
    () => api.get(endpoints.courierPayout.summary, true),
    [],
  );

  if (load.loading) return <div className="p-5"><Skeleton className="h-72 w-full" /></div>;
  if (load.error || !load.data) {
    return <div className="p-5"><ErrorState message={load.error ?? 'Gagal memuat'} onRetry={load.reload} /></div>;
  }

  const { availableBalance, monthEarnings, recentEntries } = load.data;

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">Pendapatan</div>
      </header>

      <Card className="bg-brand-600 p-5 text-on-brand">
        <div className="text-xs font-bold opacity-80">Saldo tersedia</div>
        <Money amount={availableBalance} className="mt-1 text-3xl font-extrabold" />
        <div className="mt-3 flex items-center gap-1.5 text-xs opacity-90">
          <TrendUp size={15} weight="fill" />
          Bulan ini <Money amount={monthEarnings} className="font-bold" />
        </div>
      </Card>

      <div className="text-sm font-extrabold">Rincian</div>
      {recentEntries.length === 0 ? (
        <CenterState icon={<Coins size={32} />} title="Belum ada pendapatan">
          Ongkos antar akan muncul di sini setelah kamu menyelesaikan pengantaran.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2">
          {recentEntries.map((e) => (
            <LedgerRow key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerRow({ entry }: { entry: CourierLedgerEntry }) {
  const credit = entry.amount >= 0;
  return (
    <Card className="flex items-center justify-between p-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">{entry.description}</div>
        <div className="text-[11px] tabular-nums text-[color:var(--muted)]">
          {WHEN.format(new Date(entry.occurredAt))}
        </div>
      </div>
      <div className={`shrink-0 text-sm font-extrabold ${credit ? 'text-green-600' : 'text-red-600'}`}>
        {credit ? '+' : '−'}
        <Money amount={Math.abs(entry.amount)} className="font-extrabold" />
      </div>
    </Card>
  );
}

export default function DriverEarningsPage() {
  return (
    <DriverShell nav={false}>
      <Earnings />
    </DriverShell>
  );
}
