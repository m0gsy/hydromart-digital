'use client';

import { useRouter } from 'next/navigation';
import { useT } from '@/lib/locale-context';
import { useState } from 'react';
import { ArrowLeft, Check, Clock, Coins, NavigationArrow, Phone, Recycle, SealCheck, Truck } from '@phosphor-icons/react';

import { ExternalLink } from '@/components/external-link';
import { RemoteImage } from '@/components/remote-image';
import { DriverShell } from '@/components/driver/driver-shell';
import { LiveNav } from '@/components/driver/live-nav';
import { PodCapture } from '@/components/driver/pod-capture';
import { DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE } from '@/components/driver/status';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Delivery, DeliveryStatus } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

const TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const STAMP = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
// Dictionary KEYS — module scope, so t() runs where each step is rendered.
const STEPS: { status: DeliveryStatus; label: string; at: keyof Delivery }[] = [
  { status: 'ASSIGNED', label: 'hrFix.deliveryDetail.assigned', at: 'assignedAt' },
  { status: 'PICKED_UP', label: 'hrFix.deliveryDetail.pickedUp', at: 'pickedUpAt' },
  { status: 'ON_DELIVERY', label: 'hrFix.deliveryDetail.delivering', at: 'startedAt' },
  { status: 'DELIVERED', label: 'hrFix.deliveryDetail.done', at: 'deliveredAt' },
];
const ORDER: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED'];

function Detail() {
  const { t } = useT();
  const router = useRouter();
  const id = useQueryParam('id');
  /*
   * C1(c): the delivery, plus whether it still owes cash at the door.
   *
   * CA-4-03: this used to be TWO reads, and the second one was a guess. The screen called
   * the STAFF payment route with the courier's own token and swallowed every failure into
   * `.catch(() => false)` — so a 403 (that route is guarded by `paymentSettle`, which not
   * every dispatching role holds), a 429, and a phone that lost signal between the two
   * requests ALL rendered the green "cash already taken" badge over an unpaid order.
   *
   * The server decides it now, from the internal key, and hands back `cashHeld` on the
   * delivery itself. One read, one moment, no 403 to swallow — and `codDue` is simply its
   * inverse for an order that carries a COD at all.
   */
  const d = useAsync<{ delivery: Delivery; codDue: boolean }>(async () => {
    const delivery = await api.get<Delivery>(endpoints.deliveries.driver.get(id), true);
    return { delivery, codDue: Boolean(delivery.codAmount) && !delivery.cashHeld };
  }, [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  if (d.loading) return <div className="p-5"><Skeleton className="h-96 w-full" /></div>;
  if (d.error || !d.data) return <div className="p-5"><ErrorState message={d.error ?? t('hrFix.deliveryDetail.notFound')} onRetry={d.reload} /></div>;

  const { delivery, codDue } = d.data;
  const reached = ORDER.indexOf(delivery.status);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      d.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('hrFix.deliveryDetail.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="text-sm font-extrabold">{t('hrFix.deliveryDetail.title')}</div>
          <div className="text-[11px] tabular-nums text-[color:var(--muted)]">{delivery.orderNumber}</div>
        </div>
        <Badge tone={DELIVERY_STATUS_TONE[delivery.status]}>{t(DELIVERY_STATUS_LABEL[delivery.status])}</Badge>
      </header>

      {/* ponytail: no embedded map — "Navigasi" hands off to the courier's own maps app. */}
      <Card className="overflow-hidden p-0">
        <div className="p-4">
        <div className="text-sm font-bold">{delivery.destinationAddress}</div>
        {/*
          B5b. The window the customer chose at checkout, beside the landmark it travelled
          with. Both are snapshotted onto the delivery at assignment for the same reason:
          this screen must not need a second service to answer a question about the box in
          the courier's hand. Before B5 the window reached nobody at all — stored by
          order-service, returned by its own DTO, and read by no screen in the app.
        */}
        {delivery.deliveryWindow && (
          <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-[12.5px] font-bold text-brand-900">
            <Clock size={14} weight="fill" className="text-brand-700" />
            {delivery.deliveryWindow}
          </div>
        )}
        {delivery.notes && (
          <div className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900">
            <span className="font-bold">{t('hrFix.deliveryDetail.landmark')} </span>
            {delivery.notes}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <ExternalLink
            href={`https://maps.google.com/?q=${delivery.destinationLat ?? ''},${delivery.destinationLng ?? ''}`}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2.5 text-sm font-bold"
          >
            <NavigationArrow size={16} className="text-brand-700" weight="fill" />
            Navigasi
          </ExternalLink>
          {delivery.recipientPhone ? (
            <ExternalLink
              href={`tel:${delivery.recipientPhone}`}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2.5 text-sm font-bold"
            >
              <Phone size={16} weight="fill" className="text-brand-700" />
              Telepon
            </ExternalLink>
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
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">{t('hrFix.deliveryDetail.orderDetail')}</div>
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
        <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">{t('hrFix.deliveryDetail.statusHistory')}</div>
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
                  <div className={`text-sm font-bold ${done ? '' : 'text-[color:var(--muted)]'}`}>{t(step.label)}</div>
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
          {t('hrFix.deliveryDetail.startDelivery')}
        </Button>
      )}
      {delivery.status === 'ON_DELIVERY' &&
        (capturing ? (
          <PodCapture deliveryId={id} orderNumber={delivery.orderNumber} onDone={() => router.replace(`/driver/deliveries/detail/success?id=${id}`)} />
        ) : (
          <div className="space-y-2">
            {/*
              * C1(c): while this delivery still owes cash, closing it is not the next step
              * — taking the money is. Selesai used to be reachable with the payment still
              * PENDING, and the end-of-shift deposit then expected nothing at all.
              */}
            {codDue ? (
              <Button disabled className="flex w-full items-center justify-center gap-2">
                <SealCheck size={19} weight="fill" />
                {t('hrFix.deliveryDetail.arrived')}
              </Button>
            ) : delivery.destinationLat != null && delivery.destinationLng != null ? (
              <LiveNav
                deliveryId={id}
                destinationLat={delivery.destinationLat}
                destinationLng={delivery.destinationLng}
                onArrive={() => setCapturing(true)}
              />
            ) : (
              <Button className="flex w-full items-center justify-center gap-2" onClick={() => setCapturing(true)}>
                <SealCheck size={19} weight="fill" />
                {t('hrFix.deliveryDetail.arrived')}
              </Button>
            )}
            {/*
              * Shown only when there IS cash to take — it used to render on every
              * delivery, prepaid ones included — and promoted to the primary action for
              * as long as the money is still outstanding.
              */}
            {delivery.codAmount ? (
              codDue ? (
                <>
                  <Button
                    className="flex w-full items-center justify-center gap-2"
                    onClick={() => router.push(`/driver/deliveries/detail/pay?id=${id}`)}
                  >
                    <Coins size={18} weight="fill" />
                    {t('hrFix.deliveryDetail.takeCashDue', { amount: IDR.format(delivery.codAmount) })}
                  </Button>
                  <p className="text-center text-[12px] font-semibold text-[color:var(--muted)]">
                    {t('hrFix.deliveryDetail.codBlocksFinish')}
                  </p>
                </>
              ) : (
                <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] py-2.5 text-sm font-bold text-green-700">
                  <Coins size={18} weight="fill" />
                  {t('hrFix.deliveryDetail.cashTaken')}
                </div>
              )
            ) : null}
            <button
              type="button"
              onClick={() => router.push(`/driver/deliveries/detail/returns?id=${id}`)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] py-2.5 text-sm font-bold"
            >
              <Recycle size={18} weight="fill" className="text-brand-700" />
              {t('hrFix.deliveryDetail.returnEmpties')}
            </button>
          </div>
        ))}

      {/*
        B9. This row used to live INSIDE the ON_DELIVERY branch above, and the domain has
        allowed FAILED and RESCHEDULED from ASSIGNED and PICKED_UP since the state machine
        was written (delivery-status.ts TRANSITIONS). So a courier who reaches the depot and
        finds the stock is not there could do exactly nothing — not fail it, not reschedule
        it. The delivery sat ASSIGNED holding a stock reservation and a courier's slot until
        somebody at a desk noticed.

        No-show is the one that stays at ON_DELIVERY, and stays there on purpose: a customer
        cannot fail to be home before the courier has set off for their home.
      */}
      {(delivery.status === 'ASSIGNED' ||
        delivery.status === 'PICKED_UP' ||
        delivery.status === 'ON_DELIVERY') && (
        <div className="flex gap-2 pt-1 text-xs font-bold text-[color:var(--muted)]">
          {delivery.status === 'ON_DELIVERY' && (
            <button type="button" onClick={() => router.push(`/driver/deliveries/detail/no-show?id=${id}`)} className="flex-1 rounded-xl border border-[color:var(--border)] py-2">
              {t('hrFix.deliveryDetail.noShow')}
            </button>
          )}
          <button type="button" onClick={() => router.push(`/driver/deliveries/detail/reschedule?id=${id}`)} className="flex-1 rounded-xl border border-[color:var(--border)] py-2">
            {t('hrFix.deliveryDetail.reschedule')}
          </button>
          <button type="button" onClick={() => router.push(`/driver/deliveries/detail/fail?id=${id}`)} className="flex-1 rounded-xl border border-[color:var(--border)] py-2 text-red-600">
            {t('hrFix.deliveryDetail.failed2')}
          </button>
        </div>
      )}
      {(delivery.status === 'FAILED' || delivery.status === 'RESCHEDULED') && (
        <Card className="p-4 text-sm">
          {delivery.status === 'RESCHEDULED' ? (
            <div>
              <div className="font-bold">{t('hrFix.deliveryDetail.rescheduled')}</div>
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
          <RemoteImage
            src={delivery.proof.photoUrl}
            alt={t('courierFix.detail.proofAlt')}
            className="max-h-40 w-full rounded-xl object-cover"
          />
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="font-bold uppercase tracking-wide text-[color:var(--muted)]">{t('hrFix.deliveryDetail.time')}</dt>
              <dd className="tabular-nums">{STAMP.format(new Date(delivery.proof.capturedAt))}</dd>
            </div>
            {/*
              K2.8b: the seal answer, shown only when there IS one. A delivery recorded
              before the column, or by an APK that never sent the field, must not be
              rendered as though the courier had testified — that is the fake evidence the
              nullable column exists to prevent.
            */}
            {delivery.proof.sealIntact !== null && (
              <div>
                <dt className="font-bold uppercase tracking-wide text-[color:var(--muted)]">
                  {t('hrFix.pod.sealLabel')}
                </dt>
                <dd className={delivery.proof.sealIntact ? '' : 'font-bold text-red-600'}>
                  {t(delivery.proof.sealIntact ? 'hrFix.pod.sealYes' : 'hrFix.pod.sealNo')}
                </dd>
              </div>
            )}
            <div>
              <dt className="font-bold uppercase tracking-wide text-[color:var(--muted)]">GPS</dt>
              <dd>
                <ExternalLink
                  href={`https://maps.google.com/?q=${delivery.proof.latitude},${delivery.proof.longitude}`}
                  className="tabular-nums text-brand-700 underline"
                >
                  {delivery.proof.latitude.toFixed(5)}, {delivery.proof.longitude.toFixed(5)}
                </ExternalLink>
              </dd>
            </div>
          </dl>
          <p className="text-[11px] leading-relaxed text-[color:var(--muted)]">{t('hrFix.deliveryDetail.podRetention')}</p>
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
