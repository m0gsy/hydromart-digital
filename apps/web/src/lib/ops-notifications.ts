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

export type OpsNotifFilter = 'all' | 'unread' | 'stock' | 'courier';

/** Chip row, shared so desktop and mobile offer the same filters (styling stays local). */
export const OPS_FILTERS: { key: OpsNotifFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'opsFix.notif.filterAll' },
  { key: 'unread', labelKey: 'opsFix.notif.filterUnread' },
  { key: 'stock', labelKey: 'opsFix.notif.filterStock' },
  { key: 'courier', labelKey: 'opsFix.notif.filterCourier' },
];

/** The two events crm-service actually emits (OPS_EVENTS). Anything else is ungrouped. */
export const OPS_EVENT_GROUP: Record<string, 'stock' | 'courier'> = {
  STOCK_LOW: 'stock',
  COURIER_INCIDENT: 'courier',
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

  const markRead = useCallback(
    (n: OpsNotification) => {
      if (n.readAt != null) return;
      setJustRead((prev) => new Set(prev).add(n.id));
      // Fire-and-forget: a failed receipt must not block the reader. The next load shows
      // the true server state.
      void api.post(endpoints.notifications.opsRead(n.id), undefined, true).catch(() => undefined);
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setJustRead(new Set(all.map((n) => n.id)));
    void api.post(endpoints.notifications.opsReadAll, undefined, true).catch(() => undefined);
  }, [all]);

  return { feed, all, visible, filter, setFilter, isRead, unreadCount, markRead, markAllRead };
}
