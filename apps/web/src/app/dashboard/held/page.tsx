'use client';

import { useState } from 'react';
import { HourglassMedium, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { can } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Order } from '@/lib/types';

/** The reason text the ordinary staff cancel records; it is what the finance trail shows. */
const CANCEL_NOTE = 'quality hold';

function HeldRow({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm(t('dashB.held.cancelConfirm', { n: order.orderNumber }))) return;
    setBusy(true);
    setError(null);
    try {
      // stale-write-ok: a status TRANSITION, not a form edit: the server's compare-and-set on the order
      // status refuses a cancel that lost a race (an order already out for delivery is not cancellable).
      // The existing cancel + refund path: the status write owes the payment reversal through the outbox.
      await api.patch(endpoints.orders.status(order.id), { status: 'CANCELLED', note: CANCEL_NOTE }, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.held.cancelError'));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{order.orderNumber}</p>
        <Badge tone="warning">{order.status}</Badge>
      </div>
      <p className="text-sm text-[color:var(--text-muted)]">
        {order.recipientName} · {formatDateTime(order.createdAt)} · <Money amount={order.total} />
      </p>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[color:var(--text-muted)]">{t('dashB.held.leaveHint')}</p>
        <Button variant="danger" loading={busy} onClick={cancel}>
          {t('dashB.held.cancelRefund')}
        </Button>
      </div>
    </Card>
  );
}

function HeldBody() {
  const { t } = useT();
  const { scopedId } = useDepot();
  const list = useAsync<Order[]>(() => api.get(endpoints.orders.held(scopedId), true), [scopedId]);
  const items = list.data ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <HourglassMedium size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashB.held.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{t('dashB.held.subtitle')}</p>
        </div>
      </div>
      {list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('dashB.held.empty')} icon={<HourglassMedium size={40} weight="fill" />}>
          {t('dashB.held.emptyBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((o) => (
            <HeldRow key={o.id} order={o} onChanged={list.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('orderFulfilment', customer?.role)) {
    return (
      <CenterState title={t('dashB.quality.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.quality.gateBody')}
      </CenterState>
    );
  }
  return <HeldBody />;
}

export default function HeldOrdersPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
