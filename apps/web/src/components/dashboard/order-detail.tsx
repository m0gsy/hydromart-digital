'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { Badge, Button, Field, Input, Money } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { nextStatus, staffCanAdvance, statusLabel, tone } from '@/lib/order-status';
import { printReceipt } from '@/lib/receipt';
import { useAuth } from '@/lib/auth-context';
import { canConfirmPayment } from '@/lib/roles';
import { dispatchableDrivers, type CourierShift } from '@/lib/roster';
import { useAsync } from '@/lib/use-async';
import type { Customer, Order, Page, Payment } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

/** Payment status + staff "confirm received" for cash/transfer/QRIS (settlement). */
function PaymentSettle({ order }: { order: Order }) {
  const { customer } = useAuth();
  const canConfirm = canConfirmPayment(customer?.role);
  const { data, reload } = useAsync<Page<Payment>>(() => api.get(endpoints.payments.forOrderStaff(order.id), true), [order.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cash, setCash] = useState('');
  const payment = data?.items[0];
  const isCash = payment?.method === 'CASH';

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
      setError(err instanceof ApiError ? err.message : 'Gagal konfirmasi pembayaran.');
    } finally {
      setBusy(false);
    }
  }

  if (!payment) return null;
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
          label="Uang tunai diterima (opsional)"
          htmlFor={`settle-cash-${payment.id}`}
          hint="Diisi = kembalian ikut tercatat pada pembayaran."
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
      {canConfirm && pending && (
        <Button onClick={confirm} loading={busy}>
          Konfirmasi lunas
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
  const drivers = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);
  // Who may actually be handed a delivery right now. delivery-service refuses an
  // assignment to a courier with no open shift, so offering them here only produced a
  // rejection after the click — the dropdown says so up front instead.
  const { data: shifts } = useAsync<CourierShift[]>(() => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    return api
      .get<CourierShift[]>(
        endpoints.deliveries.shiftsOnDuty(since.toISOString(), order.depotId ?? undefined),
        true,
      )
      // Fail-soft: if the shift view is unreachable the list stays selectable and the
      // service still has the final say — better than blocking every dispatch.
      .catch(() => [] as CourierShift[]);
  }, [order.depotId]);
  const onDuty = dispatchableDrivers(shifts ?? []);
  // The order's payment (staff read) → a CASH order dispatches with the COD amount the
  // courier collects. Fail-soft: null on error → non-COD.
  const { data: paymentPage } = useAsync<Page<Payment> | null>(
    () => api.get(endpoints.payments.forOrderStaff(order.id), true),
    [order.id],
  );
  const payment = paymentPage?.items[0];
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (driverId === '') {
      setError('Pilih kurir.');
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
          items: order.items.map((i) => ({ name: i.productName, qty: i.quantity })),
          // CASH order → the courier collects the order total on delivery (COD). Non-cash
          // (TRANSFER/QRIS, already settled to the depot) sends nothing → non-COD.
          codAmount: payment?.method === 'CASH' ? order.total : undefined,
          // Snapshot the customer's landmark/note so the courier sees it on the delivery.
          notes: order.notes ?? undefined,
        },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menugaskan kurir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-app pt-3">
      <p className="text-sm font-semibold">Tugaskan kurir</p>
      {drivers.loading ? (
        <p className="text-sm text-muted">Memuat kurir…</p>
      ) : drivers.error ? (
        <p className="text-sm font-medium text-red-600">{drivers.error}</p>
      ) : !drivers.data || drivers.data.length === 0 ? (
        <p className="text-sm text-muted">Belum ada kurir aktif. Undang kurir di menu Staf &amp; peran.</p>
      ) : (
        <Field label="Kurir" htmlFor="d-id">
          <select
            id="d-id"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium"
          >
            <option value="">Pilih kurir…</option>
            {drivers.data.map((d) => (
              <option key={d.id} value={d.id} disabled={shifts != null && !onDuty.has(d.id)}>
                {d.fullName || d.phone}
                {shifts != null && !onDuty.has(d.id) ? ' — belum buka shift' : ''}
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
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = nextStatus(order.status);
  const canAdvance = staffCanAdvance(order.status) && next;
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
      setError(err instanceof ApiError ? err.message : 'Gagal memperbarui pesanan.');
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
            {order.isWalkIn && <Badge tone="neutral">Walk-in</Badge>}
            <Badge tone={TONE_BADGE[tone(order.status)]}>{statusLabel(order.status)}</Badge>
          </div>
        </div>

        <div className="rounded-2xl border border-app p-3 text-sm">
          <p className="font-semibold">{order.recipientName}</p>
          <p className="text-muted">{order.phone}</p>
          <p className="text-muted">
            {order.addressLine}, {order.city}, {order.province}
            {order.postalCode ? ` ${order.postalCode}` : ''}
          </p>
          {order.notes && <p className="mt-1 text-muted">Catatan: {order.notes}</p>}
          {order.driverName && <p className="mt-1 font-medium">Kurir: {order.driverName}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold">Item</p>
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
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular-nums">
                <Money amount={order.subtotal} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Ongkir</dt>
              <dd className="tabular-nums">
                <Money amount={order.deliveryFee} />
              </dd>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Diskon</dt>
                <dd className="tabular-nums text-emerald-700">
                  −<Money amount={order.discount} />
                </dd>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
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
            <p className="font-semibold text-red-700">Pesanan dibatalkan</p>
            <p className="text-red-700/80">
              Pesanan berbayar online wajib direfund oleh finance/manajer. Status refund dikelola di payment-service
              (belum tersambung ke antrean ini).
            </p>
          </div>
        )}

        {order.history.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">Riwayat status</p>
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
          <Button variant="ghost" onClick={() => printReceipt(order)}>
            Cetak struk
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
