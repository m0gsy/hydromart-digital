'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { Badge, Button, Field, Input, Money } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { nextStatus, staffCanAdvance, statusLabel, tone } from '@/lib/order-status';
import type { Order } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

/**
 * Assign a courier to a PREPARING order (9b). POST /deliveries advances the order
 * to DRIVER_ASSIGNED. ponytail: driverId is entered by hand — there is no
 * dispatch-accessible driver roster endpoint (the staff directory is head-office
 * gated). Add a driver-picker dropdown once such an endpoint exists.
 */
function AssignCourier({ order, onDone }: { order: Order; onDone: () => void }) {
  const [driverId, setDriverId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (driverId.trim() === '') {
      setError('Masukkan ID kurir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.deliveries.assign,
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          driverId: driverId.trim(),
          driverName: driverName.trim() || undefined,
          depotId: order.depotId ?? undefined,
          destinationAddress: `${order.addressLine}, ${order.city}`,
          destinationLat: order.latitude ?? undefined,
          destinationLng: order.longitude ?? undefined,
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
      <Field label="ID kurir" htmlFor="d-id">
        <Input id="d-id" value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="UUID kurir" />
      </Field>
      <Field label="Nama kurir (opsional)" htmlFor="d-name">
        <Input id="d-name" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="mis. Budi" />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
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
          <Badge tone={TONE_BADGE[tone(order.status)]}>{statusLabel(order.status)}</Badge>
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

        {canAdvance && (
          <Button onClick={advance} loading={advancing}>
            Lanjut ke {statusLabel(next)}
          </Button>
        )}
        {canAssign && <AssignCourier order={order} onDone={done} />}
      </div>
    </Sheet>
  );
}
