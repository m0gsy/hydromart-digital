'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useConfirm } from '@/components/confirm';
import { ExternalLink } from '@/components/external-link';
import { RemoteImage } from '@/components/remote-image';
import { Sheet } from '@/components/overlay';
import { Badge, Button, Field, Input, LoadError, Money } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, mediaUrl } from '@/lib/format';
import { nextStatus, staffCanAdvance, statusLabel, tone } from '@/lib/order-status';
import { printReceipt } from '@/lib/receipt';
import { useAuth } from '@/lib/auth-context';
import { can, canConfirmPayment } from '@/lib/roles';
import { dispatchableDrivers, type CourierShift } from '@/lib/roster';
import { useAsync } from '@/lib/use-async';
import type { Customer, Order, Page, Payment } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

/** Payment status + staff "confirm received" for cash/transfer/QRIS (settlement). */
export function PaymentSettle({ order }: { order: Order }) {
  const { t } = useT();
  const { customer } = useAuth();
  const { askReason } = useConfirm();
  const canConfirm = canConfirmPayment(customer?.role);
  // CA-2-24 — the same capability payment-service checks on POST :id/refund, so the button
  // is offered to exactly the roles the server will serve and to nobody else.
  const canRefund = can('refundIssue', customer?.role);
  const { data, error: readError, reload } = useAsync<Page<Payment>>(
    () => api.get(endpoints.payments.forOrderStaff(order.id), true),
    [order.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cash, setCash] = useState('');
  const payment = data?.items[0];
  const isCash = payment?.method === 'CASH';
  // A service-relative proof path only resolves against the gateway; rendering it raw is
  // the same bug that broke the QRIS image on the customer's own payment screen.
  const proofSrc = mediaUrl(payment?.proofUrl);

  async function confirm() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    // Cash settled here (a counter sale whose payment leg failed, or a COD handed over)
    // carries the note the buyer got change from. Confirming without it left cashReceived
    // null on the row, so the printed change was recorded nowhere.
    const received = Number(cash.replace(/\D/g, '')) || 0;
    try {
      await api.post(
        endpoints.payments.confirm(payment.id),
        isCash && received > 0 ? { cashReceived: received } : undefined,
        true,
      );
      setCash('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.orderDetail.payFailed'));
    } finally {
      setBusy(false);
    }
  }

  /*
   * CA-2-24 — start a refund on a payment that already settled.
   *
   * `refundIssue` (FINANCE + MANAGER) has been on the RBAC matrix and on the route since
   * the refund queue shipped, and no screen in the console ever called it: the only refunds
   * that could be started were the ones a customer's own cancellation started for them. A
   * wrong charge, a short delivery or a duplicate QRIS scan had no path at all — the row on
   * the reconciliation screen named the problem and nothing on it could act.
   *
   * `askReason`, not `confirm`: the reason is what the customer and the audit trail read
   * back, and a refund is not undoable, which is the rule step 06 wrote for this whole
   * console. Above the HQ threshold the server parks it for finance instead of moving
   * money, and the row simply comes back as it was.
   */
  async function refund() {
    if (!payment) return;
    const reason = await askReason({
      title: t('hrFix.orderDetail.refundTitle'),
      message: t('hrFix.orderDetail.refundMessage', { order: order.orderNumber }),
      label: t('hrFix.orderDetail.refundReason'),
      placeholder: t('hrFix.orderDetail.refundReasonHint'),
      confirmLabel: t('hrFix.orderDetail.refundConfirm'),
      tone: 'danger',
    });
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.payments.refund(payment.id), { reason }, true);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.orderDetail.refundFailed'));
    } finally {
      setBusy(false);
    }
  }

  // An unread payment removes the whole settle panel — the same shape as an order that
  // genuinely has no payment row, except here the cash is real and nobody can confirm it.
  if (!payment) return readError ? <LoadError onRetry={reload} /> : null;
  const pending = payment.status === 'PENDING';
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-app p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Pembayaran · {payment.method}</span>
        <Badge tone={payment.status === 'PAID' ? 'success' : pending ? 'warning' : 'neutral'}>{payment.status}</Badge>
      </div>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      {canConfirm && pending && isCash && (
        <Field
          label={t('hrFix.orderDetail.cashReceived')}
          htmlFor={`settle-cash-${payment.id}`}
          hint={t('hrFix.orderDetail.cashHint')}
        >
          <Input
            id={`settle-cash-${payment.id}`}
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            inputMode="numeric"
            placeholder="50000"
          />
        </Field>
      )}
      {/*
        K2.1b: the receipt the payer uploaded, beside the button that used to be pressed
        blind. `offlineInstruction` has always told a TRANSFER customer to keep their
        receipt and a QRIS customer to show it to staff — and there was nowhere to put it,
        so the proof was a WhatsApp message to whoever's number they had. "Belum diunggah"
        is said out loud rather than guessed: the operator can see there is nothing to
        check before deciding to confirm anyway.
      */}
      {!isCash && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">
            {t('hrFix.orderDetail.proofLabel')}
          </span>
          {proofSrc ? (
            <ExternalLink href={proofSrc} className="self-start">
              <RemoteImage
                src={proofSrc}
                alt={t('hrFix.orderDetail.proofLabel')}
                width={160}
                height={160}
                className="max-h-40 w-auto rounded-xl border border-app object-contain"
              />
            </ExternalLink>
          ) : (
            <span className="text-sm text-muted">{t('hrFix.orderDetail.proofMissing')}</span>
          )}
        </div>
      )}
      {canConfirm && pending && (
        <Button onClick={confirm} loading={busy}>
          Konfirmasi lunas
        </Button>
      )}
      {canRefund && payment.status === 'PAID' && (
        <Button variant="secondary" onClick={refund} loading={busy}>
          {t('hrFix.orderDetail.refundAction')}
        </Button>
      )}
    </div>
  );
}

/**
 * Assign a courier to a PREPARING order (9b). POST /deliveries advances the order
 * to DRIVER_ASSIGNED. Picks the courier from the active-driver roster
 * (GET /auth/drivers, dispatch-accessible).
 */
function AssignCourier({ order, onDone }: { order: Order; onDone: () => void }) {
  const { t } = useT();
  const drivers = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);
  // Who may actually be handed a delivery right now. delivery-service refuses an
  // assignment to a courier with no open shift, so offering them here only produced a
  // rejection after the click — the dropdown says so up front instead.
  const { data: shifts } = useAsync<CourierShift[] | null>(() => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    return api
      .get<CourierShift[]>(
        endpoints.deliveries.shiftsOnDuty(since.toISOString(), order.depotId ?? undefined),
        true,
      )
      /*
       * C-1: `null`, NOT `[]`. Fail-soft means the list stays selectable and the service
       * keeps the final say — but an empty array is a real answer meaning "nobody is on
       * shift", and the guard below reads `shifts != null`. Catching to `[]` therefore
       * disabled every courier and labelled them all "belum buka shift", so one transient
       * 5xx from delivery-service blocked dispatch entirely — the exact opposite of what
       * this catch is for.
       */
      .catch(() => null);
  }, [order.depotId]);
  const onDuty = dispatchableDrivers(shifts ?? []);
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (driverId === '') {
      setError(t('hrFix.orderDetail.pickCourierFirst'));
      return;
    }
    const driver = drivers.data?.find((d) => d.id === driverId);
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.deliveries.assign,
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          driverId,
          driverName: driver?.fullName || undefined,
          driverPhone: driver?.phone || undefined,
          depotId: order.depotId ?? undefined,
          destinationAddress: `${order.addressLine}, ${order.city}`,
          destinationLat: order.latitude ?? undefined,
          destinationLng: order.longitude ?? undefined,
          recipientPhone: order.phone,
          // Snapshotted so a notification about this delivery can thread into the
          // customer's in-app feed, not only reach their phone.
          customerId: order.customerId,
          items: order.items.map((i) => ({ name: i.productName, qty: i.quantity })),
          // No codAmount: delivery-service reads the payment itself now. This screen could
          // not — `paymentSettle` excludes SUPERVISOR and ASSISTANT_SUPERVISOR, who are
          // allowed to dispatch, so their read 403'd and every cash order they sent out
          // went as non-COD.
          // Snapshot the customer's landmark/note so the courier sees it on the delivery.
          notes: order.notes ?? undefined,
          // B5: snapshot the window onto the delivery, the same way the landmark is —
          // the courier's screen must not need a second service to answer a question
          // about the box in their hand.
          deliveryWindow: order.deliveryWindow ?? undefined,
        },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.orderDetail.assignFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-app pt-3">
      <p className="text-sm font-semibold">{t('hrFix.orderDetail.assignCourier')}</p>
      {drivers.loading ? (
        <p className="text-sm text-muted">{t('hrFix.orderDetail.loadingCouriers')}</p>
      ) : drivers.error ? (
        <p className="text-sm font-medium text-red-600">{drivers.error}</p>
      ) : !drivers.data || drivers.data.length === 0 ? (
        <p className="text-sm text-muted">{t('hrFix.orderDetail.noCouriers')}</p>
      ) : (
        <Field label={t('hrFix.orderDetail.courier')} htmlFor="d-id">
          <select
            id="d-id"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium"
          >
            <option value="">{t('hrFix.orderDetail.pickCourier')}</option>
            {drivers.data.map((d) => (
              <option key={d.id} value={d.id} disabled={shifts != null && !onDuty.has(d.id)}>
                {d.fullName || d.phone}
                {shifts != null && !onDuty.has(d.id) ? ` ${t('hrFix.orderDetail.noShift')}` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy} disabled={!drivers.data || drivers.data.length === 0}>
          Tugaskan &amp; kirim
        </Button>
      </div>
    </div>
  );
}

/** Full order drill-down (7a/3i): items, address, status timeline, advance + assign. */
export function OrderDetail({ order, onClose, onChanged }: { order: Order; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useT();
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = nextStatus(order.status);
  const canAdvance = staffCanAdvance(order.status, order.staffCanComplete) && next;
  const canAssign = order.status === 'PREPARING';

  async function advance() {
    if (!next) return;
    setAdvancing(true);
    setError(null);
    try {
      await api.patch(endpoints.orders.status(order.id), { status: next }, true);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.orderDetail.updateFailed'));
      setAdvancing(false);
    }
  }

  function done() {
    onChanged();
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={order.orderNumber}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted">{formatDateTime(order.createdAt)}</div>
          <div className="flex items-center gap-2">
            {/* A zero-fee, already-COMPLETED order is a counter sale, not a broken delivery. */}
            {order.isWalkIn && <Badge tone="neutral">{t('hrFix.orderDetail.walkIn')}</Badge>}
            <Badge tone={TONE_BADGE[tone(order.status)]}>{statusLabel(order.status)}</Badge>
          </div>
        </div>

        <div className="rounded-2xl border border-app p-3 text-sm">
          <p className="font-semibold">{order.recipientName}</p>
          <p className="text-muted">{order.phone}</p>
          <p className="text-muted">
            {order.addressLine}, {order.city}
            {order.province ? `, ${order.province}` : ''}
            {order.postalCode ? ` ${order.postalCode}` : ''}
          </p>
          {order.notes && <p className="mt-1 text-muted">Catatan: {order.notes}</p>}
          {/*
            B5. The customer picks a delivery window at checkout, is shown a confirmation of
            it, and it reached nobody: not this sheet, not the courier payload. The depot
            scheduling the run was blind to a choice the customer had already been promised.
          */}
          {order.deliveryWindow && (
            <p className="mt-1 font-medium text-brand-700">
              {t('hrFix.orderDetail.window')}: {order.deliveryWindow}
            </p>
          )}
          {order.driverName && <p className="mt-1 font-medium">Kurir: {order.driverName}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold">{t('hrFix.orderDetail.items')}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3">
                <span>
                  {it.quantity}× {it.productName}
                </span>
                <Money amount={it.lineTotal} className="tabular-nums" />
              </li>
            ))}
          </ul>
          <dl className="mt-2 border-t border-app pt-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t('hrFix.orderDetail.subtotal')}</dt>
              <dd className="tabular-nums">
                <Money amount={order.subtotal} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('hrFix.orderDetail.deliveryFee')}</dt>
              <dd className="tabular-nums">
                <Money amount={order.deliveryFee} />
              </dd>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">{t('hrFix.orderDetail.discount')}</dt>
                <dd className="tabular-nums text-emerald-700">
                  −<Money amount={order.discount} />
                </dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>{t('hrFix.orderDetail.total')}</dt>
              <dd className="tabular-nums">
                <Money amount={order.total} />
              </dd>
            </div>
          </dl>
        </div>

        <PaymentSettle order={order} />

        {order.status === 'CANCELLED' && (
          // ponytail: a real per-refund status timeline (9a) needs a staff-readable
          // payment-by-order endpoint (payment reads are customer-scoped today).
          // Surface the cancellation + the refund rule honestly instead of faking it.
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/40 dark:bg-red-950/20">
            <p className="font-semibold text-red-700">{t('hrFix.orderDetail.cancelled')}</p>
            <p className="text-red-700/80">{t('hrFix.orderDetail.onlineRefundHint')}</p>
          </div>
        )}

        {order.history.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">{t('hrFix.orderDetail.statusHistory')}</p>
            <ol className="flex flex-col gap-2">
              {order.history.map((h, i) => (
                <li key={`${h.status}-${i}`} className="flex gap-2.5 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <p className="font-medium">{statusLabel(h.status)}</p>
                    <p className="text-xs text-muted">{formatDateTime(h.createdAt)}</p>
                    {h.note && <p className="text-xs text-muted">{h.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => printReceipt(order, { t, locale })}>
            {t('hrFix.orderDetail.printReceipt2')}
          </Button>
          {canAdvance && (
            <Button onClick={advance} loading={advancing}>
              Lanjut ke {statusLabel(next)}
            </Button>
          )}
        </div>
        {canAssign && <AssignCourier order={order} onDone={done} />}
      </div>
    </Sheet>
  );
}
