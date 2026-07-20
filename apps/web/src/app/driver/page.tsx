'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MapPin, Megaphone, Package, Pause, Storefront, Warning } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { ONBOARDED_KEY } from './onboarding/constants';
import { PodCapture } from '@/components/driver/pod-capture';
import { DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE } from '@/components/driver/status';
import { Badge, Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Broadcast, CourierPerformance, Delivery, DeliveryStatus, Page, Shift } from '@/lib/types';

const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

/** YYYY-MM-DD of the WIB (UTC+7) Monday of the current week — matches the performance page. */
function thisWibMonday(): string {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const daysFromMon = (wib.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - daysFromMon));
  return monday.toISOString().slice(0, 10);
}

function DriverConsole() {
  const router = useRouter();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? undefined;
  const shift = useAsync<Shift | null>(() => api.get(endpoints.deliveries.shifts.current, true), []);
  const list = useAsync<Page<Delivery>>(() => api.get(endpoints.deliveries.driver.list(), true), []);
  const perf = useAsync<CourierPerformance>(
    () => api.get(endpoints.deliveries.performance(thisWibMonday(), depotId), true),
    [depotId],
  );
  const broadcasts = useAsync<Broadcast[]>(
    () => (depotId ? api.get(endpoints.broadcasts.forDepot(depotId), true) : Promise.resolve([])),
    [depotId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);

  // First-ever launch → run the 4-step walkthrough before anything else (design 6c).
  // localStorage read in an effect to avoid an SSR/hydration mismatch.
  useEffect(() => {
    if (localStorage.getItem(ONBOARDED_KEY) !== '1') router.replace('/driver/onboarding');
  }, [router]);

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
  const urgent = (broadcasts.data ?? []).find((b) => b.level === 'URGENT' && !b.read);

  return (
    <div className="space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Pengantaran saya</h1>
          {depotId && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-[color:var(--muted)]">
              <Storefront size={12} weight="fill" className="text-brand-700" />
              Bertugas di depot
            </span>
          )}
        </div>
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

      <div className="flex gap-2.5">
        <StatChip value={String(deliveries.length)} label="Aktif" />
        <StatChip value={perf.data ? String(perf.data.delivered) : '—'} label="Selesai" />
        <StatChip
          value={perf.data ? `${Math.round(perf.data.onTimeRate * 100)}%` : '—'}
          label="Tepat"
        />
      </div>

      {urgent && (
        <Link
          href="/driver/announcements"
          className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5"
        >
          <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-red-600" />
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-red-700">{urgent.title}</div>
            <div className="truncate text-xs text-red-600/80">{urgent.body}</div>
          </div>
        </Link>
      )}
      {!urgent && (broadcasts.data?.length ?? 0) > 0 && (
        <Link
          href="/driver/announcements"
          className="flex items-center gap-2 rounded-2xl border border-[color:var(--border)] p-3.5 text-sm font-bold"
        >
          <Megaphone size={16} weight="fill" className="text-brand-700" />
          Pengumuman depot
          <span className="ml-auto text-xs font-normal text-[color:var(--muted)]">Lihat</span>
        </Link>
      )}

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
              <Badge tone={DELIVERY_STATUS_TONE[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Badge>
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

/** Compact home-screen stat tile (Aktif / Selesai / Tepat). */
function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <Card className="flex-1 p-3">
      <div className="text-lg font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">{label}</div>
    </Card>
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
