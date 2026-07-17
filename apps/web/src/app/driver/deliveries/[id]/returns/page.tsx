'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, CheckCircle, Minus, Plus, Recycle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, ErrorState, Field, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Delivery } from '@/lib/types';

interface GallonReturnResult {
  id: string;
  quantity: number;
  condition: 'GOOD' | 'DAMAGED';
  depositRefunded: number;
}

function Returns() {
  const router = useRouter();
  const id = String(useParams().id);
  const load = useAsync<Delivery>(() => api.get<Delivery>(endpoints.deliveries.driver.get(id), true), [id]);

  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<'GOOD' | 'DAMAGED'>('GOOD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<GallonReturnResult | null>(null);

  if (load.loading) return <div className="p-5"><Skeleton className="h-72 w-full" /></div>;
  if (load.error || !load.data) {
    return <div className="p-5"><ErrorState message={load.error ?? 'Gagal memuat'} onRetry={load.reload} /></div>;
  }

  const delivery = load.data;

  const submit = async () => {
    if (!delivery.depotId) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await api.post<GallonReturnResult>(
        endpoints.deliveries.gallonReturns.create,
        { depotId: delivery.depotId, orderId: delivery.orderId, quantity, condition },
        true,
      );
      setDone(rec);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mencatat retur. Coba lagi.');
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
        <div className="flex-1">
          <div className="text-sm font-extrabold">Retur galon kosong</div>
          <div className="text-[11px] tabular-nums text-[color:var(--muted)]">{delivery.orderNumber}</div>
        </div>
      </header>

      {done ? (
        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <CheckCircle size={44} weight="fill" className="text-green-600" />
          <div className="text-base font-extrabold">Retur tercatat</div>
          <div className="text-sm text-[color:var(--muted)]">
            {done.quantity} galon ({done.condition === 'GOOD' ? 'baik' : 'rusak'}) · deposit dikembalikan
          </div>
          <Money amount={done.depositRefunded} className="text-2xl font-extrabold text-brand-700" />
          <Button className="mt-3 w-full" onClick={() => router.replace(`/driver/deliveries/${id}`)}>
            Kembali ke detail
          </Button>
        </Card>
      ) : !delivery.depotId ? (
        <Card className="p-5 text-sm text-[color:var(--muted)]">
          Pengantaran ini belum terhubung ke depot, jadi retur tidak bisa dicatat.
        </Card>
      ) : (
        <>
          <Card className="space-y-4 p-4">
            <Field label="Jumlah galon kembali">
              <div className="flex items-center justify-center gap-5">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="flex size-11 items-center justify-center rounded-full bg-black/5"
                  aria-label="Kurangi"
                >
                  <Minus size={18} weight="bold" />
                </button>
                <span className="w-10 text-center text-2xl font-extrabold tabular-nums">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  className="flex size-11 items-center justify-center rounded-full bg-brand-600 text-white"
                  aria-label="Tambah"
                >
                  <Plus size={18} weight="bold" />
                </button>
              </div>
            </Field>

            <Field label="Kondisi galon">
              <div className="flex gap-2">
                {(['GOOD', 'DAMAGED'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCondition(c)}
                    className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-bold ${
                      c === condition ? (c === 'DAMAGED' ? 'bg-red-600 text-white' : 'bg-brand-600 text-white') : 'bg-black/5'
                    }`}
                  >
                    {c === 'GOOD' ? 'Baik' : 'Rusak'}
                  </button>
                ))}
              </div>
            </Field>
            {condition === 'DAMAGED' && (
              <p className="text-[11px] text-[color:var(--muted)]">Galon rusak dicatat tapi tidak mengembalikan deposit.</p>
            )}
          </Card>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button loading={busy} className="flex w-full items-center justify-center gap-2" onClick={submit}>
            <Recycle size={18} weight="fill" />
            Catat retur
          </Button>
        </>
      )}
    </div>
  );
}

export default function DriverReturnsPage() {
  return (
    <DriverShell nav={false}>
      <Returns />
    </DriverShell>
  );
}
