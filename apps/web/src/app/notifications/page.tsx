'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  Bell,
  CheckCircle,
  Coin,
  Gift,
  Package,
  Receipt,
  Ticket,
  Truck,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Notification, NotificationEvent } from '@/lib/types';

const LAST_SEEN_KEY = 'hydromart.notifications.lastSeen';

// Event → icon + tint (spec 5h colour language: success for fulfilment, danger
// for cancel, brand for the rest).
const EVENT_STYLE: Record<NotificationEvent, { icon: Icon; fg: string; bg: string }> = {
  ORDER_RECEIVED: { icon: Receipt, fg: 'text-brand-600', bg: 'bg-brand-50' },
  ORDER_CONFIRMED: { icon: Receipt, fg: 'text-brand-600', bg: 'bg-brand-50' },
  ORDER_ON_DELIVERY: { icon: Truck, fg: 'text-[color:var(--success)]', bg: 'bg-[color:var(--success-bg)]' },
  ORDER_DELIVERED: { icon: CheckCircle, fg: 'text-[color:var(--success)]', bg: 'bg-[color:var(--success-bg)]' },
  ORDER_COMPLETED: { icon: CheckCircle, fg: 'text-[color:var(--success)]', bg: 'bg-[color:var(--success-bg)]' },
  ORDER_CANCELLED: { icon: XCircle, fg: 'text-[color:var(--danger)]', bg: 'bg-[color:var(--danger-bg)]' },
  CUSTOMER_REGISTERED: { icon: Gift, fg: 'text-brand-600', bg: 'bg-brand-50' },
  STOCK_LOW: { icon: Package, fg: 'text-brand-600', bg: 'bg-brand-50' },
  POINTS_EARNED: { icon: Coin, fg: 'text-[#b97d10]', bg: 'bg-[#faf1de]' },
  VOUCHER_GRANTED: { icon: Ticket, fg: 'text-brand-600', bg: 'bg-brand-50' },
  REORDER_REMINDER: { icon: ArrowsClockwise, fg: 'text-brand-600', bg: 'bg-brand-50' },
};

function Feed() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<Notification[]>(() =>
    api.get(endpoints.notifications.me, true),
  );

  // ponytail: read-state lives in localStorage (a single "last seen" timestamp) —
  // the crm notifications table is an append-only audit trail with no per-row read
  // flag. Upgrade to a server flag only if cross-device read sync is needed.
  const [lastSeen, setLastSeen] = useState<string>('');
  useEffect(() => {
    setLastSeen(localStorage.getItem(LAST_SEEN_KEY) ?? '');
  }, []);

  const hasUnread = useMemo(
    () => (data ?? []).some((n) => n.createdAt > lastSeen),
    [data, lastSeen],
  );

  function markAllRead() {
    const now = new Date().toISOString();
    localStorage.setItem(LAST_SEEN_KEY, now);
    setLastSeen(now);
  }

  return (
    <div className="mx-auto max-w-[430px]">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{t('notifications.title')}</h1>
        {hasUnread && (
          <button
            type="button"
            onClick={markAllRead}
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            {t('notifications.markRead')}
          </button>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[74px] w-full rounded-[14px]" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <CenterState icon={<Bell size={40} weight="duotone" />} title={t('notifications.emptyTitle')}>
            {t('notifications.emptyBody')}
          </CenterState>
        ) : (
          <div className="flex flex-col gap-2.5">
            {data.map((n) => {
              const style = EVENT_STYLE[n.event] ?? EVENT_STYLE.ORDER_RECEIVED;
              const Ic = style.icon;
              const unread = n.createdAt > lastSeen;
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 rounded-[14px] border border-app px-3.5 py-[13px] ${
                    unread ? 'bg-brand-50/40' : 'surface'
                  }`}
                >
                  <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${style.bg}`}>
                    <Ic size={19} weight="fill" className={style.fg} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-extrabold">{t(`notifications.events.${n.event}`)}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{n.message}</div>
                    <div className="mt-1.5 text-[10.5px] text-muted">{formatDateTime(n.createdAt)}</div>
                  </div>
                  {unread && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-brand-600" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <Feed />
    </RequireAuth>
  );
}
