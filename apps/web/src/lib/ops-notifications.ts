'use client';

import { useCallback, useMemo, useState } from 'react';

import { api } from './api';
import { endpoints } from './endpoints';
import { useAsync } from './use-async';
import type { OpsNotification } from './types';

/**
 * Shared ops-notification feed state for the desktop ops centre and the manager mobile
 * console — one behaviour, two presentations. Read receipts live in crm-service and are
 * per staff member, so marking read here is one-way and survives a reload (there is no
 * "mark unread": an alert someone has seen is seen).
 */

export type OpsNotifGroup = 'stock' | 'courier' | 'sales' | 'hr';
export type OpsNotifFilter = 'all' | 'unread' | OpsNotifGroup;

/** Chip row, shared so desktop and mobile offer the same filters (styling stays local). */
export const OPS_FILTERS: { key: OpsNotifFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'opsFix.notif.filterAll' },
  { key: 'unread', labelKey: 'opsFix.notif.filterUnread' },
  { key: 'stock', labelKey: 'opsFix.notif.filterStock' },
  { key: 'courier', labelKey: 'opsFix.notif.filterCourier' },
  { key: 'sales', labelKey: 'opsFix.notif.filterSales' },
  { key: 'hr', labelKey: 'opsFix.notif.filterHr' },
];

/**
 * Every event crm-service files into the ops feed, and the chip it answers to.
 *
 * F4: this named two of the nine. The other seven — an untracked sale, a meter variance,
 * the daily sales figure and all four HR events — were filed, listed under "Semua", and
 * reachable by no chip, so nobody hunting for one could narrow to it. `OPS_EVENTS` in
 * `types.ts` mirrors the service's own list and a test asserts this map covers all of it,
 * so a tenth event fails here rather than arriving invisible.
 */
export const OPS_EVENT_GROUP: Record<string, OpsNotifGroup> = {
  STOCK_LOW: 'stock',
  // A sale the depot has no stock line for, and a meter reading that disagrees with the
  // litres sold, are both "the stock ledger is wrong" — the same person chases them.
  STOCK_UNTRACKED: 'stock',
  METER_VARIANCE: 'stock',
  COURIER_INCIDENT: 'courier',
  DEPOT_SALES_UPDATE: 'sales',
  LEAVE_SUBMITTED: 'hr',
  LEAVE_APPROVED: 'hr',
  LEAVE_REJECTED: 'hr',
  HR_ANNOUNCEMENT: 'hr',
};

/** Pure: apply the chip filter. `read` decides unread-ness (server receipt + local overlay). */
export function filterOpsFeed(
  feed: OpsNotification[],
  filter: OpsNotifFilter,
  isRead: (n: OpsNotification) => boolean,
): OpsNotification[] {
  return feed.filter((n) => {
    if (filter === 'unread') return !isRead(n);
    if (filter === 'all') return true;
    return OPS_EVENT_GROUP[n.event] === filter;
  });
}

/** Pure: bucket a newest-first feed by day, preserving order. `label` renders the heading. */
export function groupOpsFeedByDay(
  feed: OpsNotification[],
  label: (iso: string) => string,
): { label: string; items: OpsNotification[] }[] {
  const out: { label: string; items: OpsNotification[] }[] = [];
  for (const n of feed) {
    const key = label(n.createdAt);
    const last = out[out.length - 1];
    if (last && last.label === key) last.items.push(n);
    else out.push({ label: key, items: [n] });
  }
  return out;
}

export function useOpsNotifications() {
  const feed = useAsync<OpsNotification[]>(() => api.get(endpoints.notifications.ops, true), []);
  const [filter, setFilter] = useState<OpsNotifFilter>('all');
  // Optimistic overlay over the server receipts: the row greys out immediately instead of
  // waiting on a refetch. Cleared naturally on reload, when the server value takes over.
  const [justRead, setJustRead] = useState<Set<string>>(new Set());

  const all = useMemo(() => feed.data ?? [], [feed.data]);
  const isRead = useCallback((n: OpsNotification) => n.readAt != null || justRead.has(n.id), [justRead]);
  const unreadCount = all.filter((n) => !isRead(n)).length;
  const visible = useMemo(() => filterOpsFeed(all, filter, isRead), [all, filter, isRead]);

  /** Undo one optimistic mark. Non-blocking still, but no longer silently wrong. */
  const unmark = useCallback((ids: string[]) => {
    setJustRead((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const markRead = useCallback(
    (n: OpsNotification) => {
      if (n.readAt != null) return;
      setJustRead((prev) => new Set(prev).add(n.id));
      // Still fire-and-forget — a failed receipt must not block the reader — but the
      // optimistic grey-out is ROLLED BACK when the receipt does not land. Swallowing the
      // failure outright left the row looking read until a reload nobody performs, which
      // is how an unread alert disappears without ever being seen.
      void api
        .post(endpoints.notifications.opsRead(n.id), undefined, true)
        .catch(() => unmark([n.id]));
    },
    [unmark],
  );

  const markAllRead = useCallback(() => {
    const ids = all.map((n) => n.id);
    setJustRead(new Set(ids));
    void api
      .post(endpoints.notifications.opsReadAll, undefined, true)
      .catch(() => unmark(ids));
  }, [all, unmark]);

  return { feed, all, visible, filter, setFilter, isRead, unreadCount, markRead, markAllRead };
}
