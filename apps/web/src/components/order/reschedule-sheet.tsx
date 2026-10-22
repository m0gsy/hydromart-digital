'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { Button, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dayKey, dayLabel, slotInstant } from '@/lib/delivery-schedule';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { DeliveryOptions, Order } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

const DAYS = [0, 1, 2, 3];
const select =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

/**
 * FR-052: the customer moves their own order to another delivery slot.
 *
 * Mounted only while open, so the depot's slots are read when somebody asks to change the time
 * and not on every visit to the order. The server decides whether the move is allowed (status,
 * the two-hour notice, the slot rules); this only asks and shows its answer.
 */
export function RescheduleSheet({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useT();
  const { toast } = useToast();
  const options = useAsync<DeliveryOptions>(
    // auth: true - this route is not public (SelfScoped); without the flag a native shell sends no
    // bearer and the gateway answers "Missing bearer token".
    () => api.get(endpoints.orders.deliveryOptions(order.depotId), true),
    [order.depotId],
  );
  const closed = new Set(options.data?.closedDates ?? []);
  const firstOpen = DAYS.find((d) => d >= 1 && !closed.has(dayKey(d))) ?? 1;
  const [picked, setDayIdx] = useState<number | null>(null);
  // The day offered first is tomorrow, or the next one the depot trades.
  const dayIdx = picked ?? firstOpen;
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = options.data?.slots ?? [];
  const chosen = slot || slots[0] || '';

  async function save() {
    const at = slotInstant(dayIdx, chosen);
    if (!at) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.orders.reschedule(order.id), { scheduledFor: at }, true);
      toast(t('order.toast.rescheduled'));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('order.detail.rescheduleError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('order.detail.rescheduleTitle')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('order.detail.rescheduleIntro')}</p>
        {options.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted">{t('order.detail.rescheduleNoSlots')}</p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {t('order.detail.rescheduleDay')}
              <select
                className={select}
                value={dayIdx}
                onChange={(e) => setDayIdx(Number(e.target.value))}
              >
                {DAYS.map((d) => (
                  <option key={d} value={d} disabled={closed.has(dayKey(d))}>
                    {dayLabel(d, locale)}
                    {closed.has(dayKey(d)) ? ` (${t('order.detail.closedDay')})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {t('order.detail.rescheduleSlot')}
              <select className={select} value={chosen} onChange={(e) => setSlot(e.target.value)}>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <Button
          onClick={save}
          loading={busy}
          disabled={slots.length === 0}
          className="h-12 rounded-2xl"
        >
          {t('order.detail.rescheduleConfirm')}
        </Button>
      </div>
    </Sheet>
  );
}
