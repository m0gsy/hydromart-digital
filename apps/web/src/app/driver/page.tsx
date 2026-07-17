'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MapPin, Package, Pause, Storefront } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { PodCapture } from '@/components/driver/pod-capture';
import { Badge, Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Delivery, DeliveryStatus, Page, Shift } from '@/lib/types';

const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  ASSIGNED: 'Ditugaskan',
  PICKED_UP: 'Diambil',
  ON_DELIVERY: 'Diantar',
  DELIVERED: 'Selesai',
  FAILED: 'Gagal',
  RESCHEDULED: 'Dijadwalkan ulang',
};

function DriverConsole() {
  const router = useRouter();
  const shift = useAsync<Shift | null>(() => api.get(endpoints.deliveries.shifts.current, true), []);
  const list = useAsync<Page<Delivery>>(() => api.get(endpoints.deliveries.driver.list(), true), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);

  // No open shift → the task list is meaningless. Send the courier to check in.
  if (!shift.loading && !shift.error && !shift.data) {
    router.replace('/driver/shift/check-in');
    return <div className="p-5"><Skeleton className="h-40 w-full" /></div>;
  }

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      list.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
    } finally {
      setBusy(null);
    }
  };

  const deliveries = (list.data?.items ?? []).filter((d) => ACTIVE.includes(d.status));
  const onBreak = shift.data?.status === 'BREAK' || shift.data?.status === 'OFFLINE';

  return (
    <div className="space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight">Pengantaran saya</h1>
        <Link
          href="/driver/shift/status"
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
            onBreak ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
          }`}
        >
          {onBreak ? <Pause size={13} weight="fill" /> : <Storefront size={13} weight="fill" />}
          {shift.data ? (onBreak ? 'Istirahat' : 'Online') : '…'}
        </Link>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : deliveries.length === 0 ? (
        <CenterState icon={<Package size={32} />} title="Belum ada tugas aktif">
          Tugas baru akan muncul di sini saat admin depot menugaskan pesanan kepada kamu.
        </CenterState>
      ) : (
        deliveries.map((d) => (
          <Card key={d.id} className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <Link href={`/driver/deliveries/${d.id}`} className="font-semibold tabular-nums">
                {d.orderNumber}
              </Link>
              <Badge>{STATUS_LABEL[d.status]}</Badge>
            </div>
            <p className="flex items-start gap-1.5 text-sm text-[color:var(--muted)]">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              {d.destinationAddress}
            </p>

            {d.status === 'ASSIGNED' && (
              <Button
                onClick={() => act(() => api.patch(endpoints.deliveries.driver.pickup(d.id), undefined, true), d.id)}
                loading={busy === d.id}
                className="w-full"
              >
                Konfirmasi barang diambil
              </Button>
            )}
            {d.status === 'PICKED_UP' && (
              <Button
                onClick={() => act(() => api.patch(endpoints.deliveries.driver.start(d.id), undefined, true), d.id)}
                loading={busy === d.id}
                className="w-full"
              >
                Mulai antar
              </Button>
            )}
            {d.status === 'ON_DELIVERY' &&
              (capturing === d.id ? (
                <PodCapture
                  deliveryId={d.id}
                  orderNumber={d.orderNumber}
                  onDone={() => {
                    setCapturing(null);
                    list.reload();
                  }}
                />
              ) : (
                <Button onClick={() => setCapturing(d.id)} className="w-full">
                  Selesaikan · ambil bukti
                </Button>
              ))}
          </Card>
        ))
      )}
    </div>
  );
}

/** Driver-facing delivery console: shift-gated task list + lifecycle actions. */
export default function DriverPage() {
  return (
    <DriverShell>
      <DriverConsole />
    </DriverShell>
  );
}
