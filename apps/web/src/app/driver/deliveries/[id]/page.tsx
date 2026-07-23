'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Check, Coins, NavigationArrow, Phone, Recycle, SealCheck, Truck } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { LiveNav } from '@/components/driver/live-nav';
import { PodCapture } from '@/components/driver/pod-capture';
import { DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE } from '@/components/driver/status';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Delivery, DeliveryStatus } from '@/lib/types';

const TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const STAMP = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const STEPS: { status: DeliveryStatus; label: string; at: keyof Delivery }[] = [
  { status: 'ASSIGNED', label: 'Ditugaskan', at: 'assignedAt' },
  { status: 'PICKED_UP', label: 'Diambil', at: 'pickedUpAt' },
  { status: 'ON_DELIVERY', label: 'Diantar', at: 'startedAt' },
  { status: 'DELIVERED', label: 'Selesai', at: 'deliveredAt' },
];
const ORDER: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED'];

function Detail() {
  const router = useRouter();
  const id = String(useParams().id);
  const d = useAsync<Delivery>(() => api.get(endpoints.deliveries.driver.get(id), true), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  if (d.loading) return <div className="p-5"><Skeleton className="h-96 w-full" /></div>;
  if (d.error || !d.data) return <div className="p-5"><ErrorState message={d.error ?? 'Tidak ditemukan'} onRetry={d.reload} /></div>;

  const delivery = d.data;
  const reached = ORDER.indexOf(delivery.status);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      d.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
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
          <div className="text-sm font-extrabold">Detail pengantaran</div>
          <div className="text-[11px] tabular-nums text-[color:var(--muted)]">{delivery.orderNumber}</div>
        </div>
        <Badge tone={DELIVERY_STATUS_TONE[delivery.status]}>{DELIVERY_STATUS_LABEL[delivery.status]}</Badge>
      </header>

      {/* ponytail: no embedded map — "Navigasi" hands off to the courier's own maps app. */}
      <Card className="overflow-hidden p-0">
        <div className="p-4">
        <div className="text-sm font-bold">{delivery.destinationAddress}</div>
        {delivery.notes && (
          <div className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900">
            <span className="font-bold">Patokan: </span>
            {delivery.notes}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <a
            href={`https://maps.google.com/?q=${delivery.destinationLat ?? ''},${delivery.destinationLng ?? ''}`}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2.5 text-sm font-bold"
          >
            <NavigationArrow size={16} className="text-brand-700" weight="fill" />
            Navigasi
          </a>
          {delivery.recipientPhone ? (
            <a
              href={`tel:${delivery.recipientPhone}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2.5 text-sm font-bold"
            >
              <Phone size={16} weight="fill" className="text-brand-700" />
              Telepon
            </a>
          ) : (
            // ponytail: recipientPhone absent on this (legacy) delivery — kept inert-but-visible.
            <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2.5 text-sm font-bold text-[color:var(--muted)]">
              <Phone size={16} weight="fill" />
              Telepon
            </span>
          )}
        </div>
        </div>
      </Card>

      {(delivery.items?.length || (delivery.codAmount != null && delivery.codAmount > 0)) && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">Rincian pesanan</div>
            {delivery.codAmount != null && delivery.codAmount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-extrabold text-amber-800">
                <Coins size={13} weight="fill" />
                COD {IDR.format(delivery.codAmount)}
              </span>
            )}
          </div>
          {delivery.items?.length ? (
            <ul className="flex flex-col gap-1.5">
              {delivery.items.map((it, i) => (
                <li key={i} className="flex justify-between text-sm">
                  <span className="font-medium">{it.name}</span>
                  <span className="tabular-nums text-[color:var(--muted)]">×{it.qty}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">Riwayat status</div>
        <ol className="flex flex-col gap-0">
          {STEPS.map((step, i) => {
            const done = i <= reached;
            const at = delivery[step.at] as string | null | undefined;
            return (
              <li key={step.status} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex size-5 items-center justify-center rounded-full ${done ? 'bg-green-600 text-white' : 'border-2 border-dashed border-[color:var(--border)]'}`}>
                    {done && <Check size={12} weight="bold" />}
                  </span>
                  {i < STEPS.length - 1 && <span className={`w-0.5 flex-1 ${done ? 'bg-green-600' : 'bg-[color:var(--border)]'}`} style={{ minHeight: 20 }} />}
                </div>
                <div className="pb-3">
                  <div className={`text-sm font-bold ${done ? '' : 'text-[color:var(--muted)]'}`}>{step.label}</div>
                  {at && <div className="text-[11px] text-[color:var(--muted)]">{TIME.format(new Date(at))}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {delivery.status === 'ASSIGNED' && (
        <Button loading={busy} className="w-full" onClick={() => act(() => api.patch(endpoints.deliveries.driver.pickup(id), undefined, true))}>
          Konfirmasi barang diambil
        </Button>
      )}
      {delivery.status === 'PICKED_UP' && (
        <Button loading={busy} className="flex w-full items-center justify-center gap-2" onClick={() => act(() => api.patch(endpoints.deliveries.driver.start(id), undefined, true))}>
          <Truck size={19} weight="fill" />
          Mulai antar
        </Button>
      )}
      {delivery.status === 'ON_DELIVERY' &&
        (capturing ? (
          <PodCapture deliveryId={id} orderNumber={delivery.orderNumber} onDone={() => router.replace(`/driver/deliveries/${id}/success`)} />
        ) : (
          <div className="space-y-2">
            {delivery.destinationLat != null && delivery.destinationLng != null ? (
              <LiveNav
                deliveryId={id}
                destinationLat={delivery.destinationLat}
                destinationLng={delivery.destinationLng}
                onArrive={() => setCapturing(true)}
              />
            ) : (
              <Button className="flex w-full items-center justify-center gap-2" onClick={() => setCapturing(true)}>
                <SealCheck size={19} weight="fill" />
                Sampai tujuan · ambil bukti
              </Button>
            )}
            <button
              type="button"
              onClick={() => router.push(`/driver/deliveries/${id}/pay`)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] py-2.5 text-sm font-bold"
            >
              <Coins size={18} weight="fill" className="text-brand-700" />
              Terima pembayaran tunai (COD)
            </button>
            <button
              type="button"
              onClick={() => router.push(`/driver/deliveries/${id}/returns`)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] py-2.5 text-sm font-bold"
            >
              <Recycle size={18} weight="fill" className="text-brand-700" />
              Retur galon kosong
            </button>
            <div className="flex gap-2 pt-1 text-xs font-bold text-[color:var(--muted)]">
              <button type="button" onClick={() => router.push(`/driver/deliveries/${id}/no-show`)} className="flex-1 rounded-xl border border-[color:var(--border)] py-2">
                Tidak di tempat
              </button>
              <button type="button" onClick={() => router.push(`/driver/deliveries/${id}/reschedule`)} className="flex-1 rounded-xl border border-[color:var(--border)] py-2">
                Jadwal ulang
              </button>
              <button type="button" onClick={() => router.push(`/driver/deliveries/${id}/fail`)} className="flex-1 rounded-xl border border-[color:var(--border)] py-2 text-red-600">
                Gagal
              </button>
            </div>
          </div>
        ))}
      {(delivery.status === 'FAILED' || delivery.status === 'RESCHEDULED') && (
        <Card className="p-4 text-sm">
          {delivery.status === 'RESCHEDULED' ? (
            <div>
              <div className="font-bold">Dijadwalkan ulang</div>
              {delivery.rescheduledFor && (
                <div className="text-[color:var(--muted)]">
                  {new Date(delivery.rescheduledFor).toLocaleString('id-ID')}
                  {delivery.rescheduleSlot ? ` · ${delivery.rescheduleSlot}` : ''}
                </div>
              )}
            </div>
          ) : (
            <div className="text-red-600">Gagal: {delivery.failureReason}</div>
          )}
        </Card>
      )}
      {delivery.status === 'DELIVERED' && delivery.proof && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-green-700">
            <SealCheck size={18} weight="fill" />
            Diterima {delivery.proof.recipientName}
          </div>
          <img
            src={delivery.proof.photoUrl}
            alt="Bukti foto pengantaran"
            className="max-h-40 w-full rounded-xl object-cover"
          />
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="font-bold uppercase tracking-wide text-[color:var(--muted)]">Waktu</dt>
              <dd className="tabular-nums">{STAMP.format(new Date(delivery.proof.capturedAt))}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-wide text-[color:var(--muted)]">GPS</dt>
              <dd>
                <a
                  href={`https://maps.google.com/?q=${delivery.proof.latitude},${delivery.proof.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="tabular-nums text-brand-700 underline"
                >
                  {delivery.proof.latitude.toFixed(5)}, {delivery.proof.longitude.toFixed(5)}
                </a>
              </dd>
            </div>
          </dl>
          <p className="text-[11px] leading-relaxed text-[color:var(--muted)]">
            Bukti antar (foto, tanda tangan, GPS) disimpan selama 12 bulan sesuai UU PDP, lalu dihapus otomatis.
          </p>
        </Card>
      )}
    </div>
  );
}

export default function DeliveryDetailPage() {
  return (
    <DriverShell nav={false}>
      <Detail />
    </DriverShell>
  );
}
