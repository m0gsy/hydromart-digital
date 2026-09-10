'use client';

import { useState } from 'react';
import { HandGrabbing } from '@phosphor-icons/react';

import { Button, Card, LoadError, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DriverSettings, Order, Page } from '@/lib/types';

/**
 * S1 — orders nobody has claimed, and a button to take one.
 *
 * Renders NOTHING unless the depot turned self-claim on. `courierSelfClaimEnabled` is 0 by
 * default, so every depot starts with no button at all rather than one that always refuses.
 *
 * The waited-long-enough line is drawn from `statusChangedAt`, the same clock the server
 * uses — but a row the client thinks is too new is still PRESSABLE, and that is deliberate:
 * the server is the authority, the phone's clock is not, and a button that greys itself out
 * against a wrong clock is a button nobody can use and nobody can explain. Pressing early
 * gets a 409 with the reason in it.
 */
export function ClaimableOrders({
  depotId,
  onClaimed,
}: {
  depotId: string | undefined;
  onClaimed: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string[]>([]);

  const settings = useAsync<DriverSettings>(
    () => api.get<DriverSettings>(endpoints.deliveries.driver.settings, true),
    [],
  );
  const enabled = (settings.data?.courierSelfClaimEnabled ?? 0) > 0;

  const orders = useAsync<Page<Order>>(
    () =>
      enabled
        ? api.get<Page<Order>>(
            endpoints.orders.manage({ status: 'CONFIRMED', depotId, limit: 20 }),
            true,
          )
        : Promise.resolve({ items: [], total: 0, page: 1, limit: 0 } as Page<Order>),
    [enabled, depotId],
  );

  // Nothing to say while the switch is unknown, and nothing at all once it says off.
  if (settings.loading) return <Skeleton className="h-24" />;
  if (!enabled) return null;

  const waitMinutes = settings.data?.courierSelfClaimWaitMinutes ?? 0;
  const rows = (orders.data?.items ?? []).filter((o) => !claimed.includes(o.id));

  async function take(orderId: string) {
    setBusy(orderId);
    setError(null);
    try {
      await api.post(endpoints.deliveries.driver.claim, { orderId }, true);
      // Struck from this list immediately: the reload below is a second round trip, and
      // leaving the row pressable in between is how one courier claims the same order twice.
      setClaimed((c) => [...c, orderId]);
      onClaimed();
      orders.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.claim.failed'));
      orders.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <HandGrabbing size={16} weight="fill" className="text-brand-700" />
          {t('driver.claim.title')}
        </h2>
        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
          {t('driver.claim.subtitle', { minutes: waitMinutes })}
        </p>
      </div>

      {error && (
        <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {orders.loading && <Skeleton className="h-12" />}
      {orders.error && <LoadError onRetry={orders.reload} />}
      {!orders.loading && !orders.error && rows.length === 0 && (
        <p className="text-xs text-[color:var(--text-muted)]">{t('driver.claim.empty')}</p>
      )}

      {rows.map((o) => (
        <div key={o.id} className="flex items-center gap-3 border-t border-app pt-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{o.orderNumber}</p>
            <p className="truncate text-xs text-[color:var(--text-muted)]">
              {o.addressLine}
              {o.statusChangedAt
                ? ` · ${t('driver.claim.waitedFor', { minutes: minutesSince(o.statusChangedAt) })}`
                : ''}
            </p>
          </div>
          <Button loading={busy === o.id} onClick={() => take(o.id)}>
            {t('driver.claim.take')}
          </Button>
        </div>
      ))}
    </Card>
  );
}

/** Whole minutes since a timestamp, never negative — a phone clock ahead of the server. */
function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}
