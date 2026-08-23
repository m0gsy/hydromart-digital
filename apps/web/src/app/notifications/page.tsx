'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  Bell,
  CheckCircle,
  Coin,
  Gift,
  Megaphone,
  Package,
  Receipt,
  Ticket,
  Truck,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import Link from 'next/link';

import { useRouter } from 'next/navigation';

import { resolveDeepLink } from '@/lib/deep-link';

import { RequireAuth } from '@/components/require-auth';
import { CenterState, ErrorState, Skeleton, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { notificationHome } from '@/lib/roles';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Notification, NotificationEvent } from '@/lib/types';

const LAST_SEEN_KEY = 'hydromart.notifications.lastSeen';

// Event → icon + tint (spec 5h colour language: success for fulfilment, danger
// for cancel, brand for the rest).
//
// F3: PARTIAL on purpose. The union now names every event crm can file, including the
// nine that go to the staff ops feed and never reach a customer inbox — giving those an
// icon here would be drawing chrome for a row this screen cannot receive. `BROADCAST`
// does reach it, so it is listed. The `??` at the call site covers the rest.
/** Anything the map does not name — a new event shipped before this screen learns it. */
const FALLBACK_STYLE = { icon: Bell, fg: 'text-brand-600', bg: 'bg-brand-50' };

const EVENT_STYLE: Partial<Record<NotificationEvent, { icon: Icon; fg: string; bg: string }>> = {
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
  BROADCAST: { icon: Megaphone, fg: 'text-brand-600', bg: 'bg-brand-50' },
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
        <h1 className="hidden text-[22px] font-extrabold tracking-[-0.02em] sm:block">{t('notifications.title')}</h1>
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
              const style = EVENT_STYLE[n.event] ?? FALLBACK_STYLE;
              const Ic = style.icon;
              const unread = n.createdAt > lastSeen;
              /*
               * O1b: the row opens what the message is about. Two guards, because the
               * column is a server-written string and an href is not a tap:
               *  - an absolute URL is refused outright. `resolveDeepLink` strips the origin
               *    and hands back the path, which is right for a tap and wrong for a link.
               *  - `/` is refused unless the row actually asked for `/`. That is what the
               *    resolver answers for a route this binary does not carry, and a row about
               *    an order must not quietly become a link to the home screen.
               * Anything left is a route this app serves; anything else stays plain text,
               * because an affordance that leads nowhere is worse than none.
               */
              const internal =
                n.destination && n.destination.startsWith('/') && !n.destination.startsWith('//')
                  ? n.destination
                  : null;
              const resolved = internal ? resolveDeepLink(internal) : null;
              const href = resolved === '/' && internal !== '/' ? null : resolved;
              const className = `flex items-start gap-3 rounded-[14px] border border-app px-3.5 py-[13px] ${
                unread ? 'bg-brand-50/40' : 'surface'
              }`;
              const inner = (
                <>
                  <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${style.bg}`}>
                    <Ic size={19} weight="fill" className={style.fg} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-extrabold">{t(`notifications.events.${n.event}`)}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{n.message}</div>
                    <div className="mt-1.5 text-[10.5px] text-muted">{formatDateTime(n.createdAt)}</div>
                  </div>
                  {unread && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-brand-600" />}
                </>
              );
              return href ? (
                <Link key={n.id} href={href} className={`${className} transition-colors hover:bg-brand-50`}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id} className={className}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * F2: this inbox is customers only — `GET /notifications/me` is `@Roles(CUSTOMER)`, so a
 * staff member reaching it gets a 403 and an error screen.
 *
 * They reach it constantly: hr-service pushes LEAVE_SUBMITTED / LEAVE_APPROVED /
 * LEAVE_REJECTED / HR_ANNOUNCEMENT with the recipient's own account id, so those DO get
 * delivered to a device, and crm's `destinationFor()` has no case for them and falls
 * through to `/notifications`. A supervisor tapping "Pengajuan cuti masuk" landed on a
 * refusal.
 *
 * The redirect lives on the page rather than in the tap handler because the tap is only
 * one of the ways in: a deep link, a bookmark and the app's own nav all arrive here too,
 * and they should all end up at the feed the person can actually read.
 */
function InboxDoor() {
  const { customer, ready } = useAuth();
  const router = useRouter();
  const staffFeed = customer && customer.role !== 'CUSTOMER' ? notificationHome(customer.role) : null;

  useEffect(() => {
    if (ready && staffFeed) router.replace(staffFeed);
  }, [ready, staffFeed, router]);

  if (staffFeed) {
    return (
      <div className="flex justify-center py-24 text-brand-500">
        <Spinner size={28} />
      </div>
    );
  }
  return <Feed />;
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <InboxDoor />
    </RequireAuth>
  );
}
