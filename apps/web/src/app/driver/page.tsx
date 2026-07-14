'use client';

import { useState } from 'react';
import { MapPin, Package, Truck } from '@phosphor-icons/react';

import { PodCapture } from '@/components/driver/pod-capture';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Delivery, DeliveryStatus, Page } from '@/lib/types';

const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  ASSIGNED: 'Ditugaskan',
  PICKED_UP: 'Diambil',
  ON_DELIVERY: 'Diantar',
  DELIVERED: 'Selesai',
  FAILED: 'Gagal',
};

function DriverConsole() {
  const list = useAsync<Page<Delivery>>(
    () => api.get(endpoints.deliveries.driver.list(), true),
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <header className="flex items-center gap-2">
        <Truck size={24} className="text-brand-600" />
        <h1 className="text-xl font-bold">Pengantaran saya</h1>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : deliveries.length === 0 ? (
        <CenterState icon={<Package size={32} />} title="Belum ada tugas aktif" />
      ) : (
        deliveries.map((d) => (
          <Card key={d.id} className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{d.orderNumber}</span>
              <Badge>{STATUS_LABEL[d.status]}</Badge>
            </div>
            <p className="flex items-start gap-1.5 text-sm text-[color:var(--muted)]">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              {d.destinationAddress}
            </p>

            {d.status === 'ASSIGNED' && (
              <Button
                onClick={() => act(() => api.post(endpoints.deliveries.driver.pickup(d.id), undefined, true), d.id)}
                loading={busy === d.id}
                className="w-full"
              >
                Konfirmasi barang diambil
              </Button>
            )}
            {d.status === 'PICKED_UP' && (
              <Button
                onClick={() => act(() => api.post(endpoints.deliveries.driver.start(d.id), undefined, true), d.id)}
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

/** Driver-facing delivery console: lifecycle actions + Proof-of-Delivery capture. */
export default function DriverPage() {
  const { customer } = useAuth();

  return (
    <RequireAuth>
      {customer?.role === 'DRIVER' ? (
        <DriverConsole />
      ) : (
        <CenterState icon={<Truck size={32} />} title="Halaman khusus kurir">
          Akun ini bukan kurir.
        </CenterState>
      )}
    </RequireAuth>
  );
}
