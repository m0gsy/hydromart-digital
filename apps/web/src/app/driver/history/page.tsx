'use client';

import { CheckCircle, XCircle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Delivery, Page } from '@/lib/types';

const TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

function History() {
  const delivered = useAsync<Page<Delivery>>(
    () => api.get(endpoints.deliveries.driver.list('DELIVERED'), true),
    [],
  );
  const failed = useAsync<Page<Delivery>>(
    () => api.get(endpoints.deliveries.driver.list('FAILED'), true),
    [],
  );

  if (delivered.loading || failed.loading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (delivered.error) return <div className="p-5"><ErrorState message={delivered.error} onRetry={delivered.reload} /></div>;

  const rows = [...(delivered.data?.items ?? []), ...(failed.data?.items ?? [])].sort((a, b) => {
    const at = new Date(a.deliveredAt ?? a.failedAt ?? a.assignedAt).getTime();
    const bt = new Date(b.deliveredAt ?? b.failedAt ?? b.assignedAt).getTime();
    return bt - at;
  });

  return (
    <div className="space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold tracking-tight">Riwayat</h1>
      <div className="flex gap-2">
        <div className="flex-1 rounded-2xl bg-green-50 px-3 py-2.5">
          <div className="text-lg font-extrabold text-green-700 tabular-nums">{delivered.data?.total ?? 0}</div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-green-700">Selesai</div>
        </div>
        <div className="flex-1 rounded-2xl bg-red-50 px-3 py-2.5">
          <div className="text-lg font-extrabold text-red-600 tabular-nums">{failed.data?.total ?? 0}</div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-red-600">Gagal</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <CenterState icon={<CheckCircle size={32} />} title="Belum ada riwayat" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((d) => {
            const ok = d.status === 'DELIVERED';
            const when = d.deliveredAt ?? d.failedAt;
            return (
              <div key={d.id} className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3.5">
                <span className={`flex size-9 items-center justify-center rounded-xl ${ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {ok ? <CheckCircle size={20} weight="fill" /> : <XCircle size={20} weight="fill" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-extrabold tabular-nums">{d.orderNumber}</div>
                  <div className="truncate text-[11px] text-[color:var(--muted)]">
                    {ok ? d.destinationAddress : (d.failureReason ?? 'Gagal')} · {when ? TIME.format(new Date(when)) : ''}
                  </div>
                </div>
                {!ok && <span className="text-[11px] font-extrabold text-red-600">Gagal</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <DriverShell>
      <History />
    </DriverShell>
  );
}
