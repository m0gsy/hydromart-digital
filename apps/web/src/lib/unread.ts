'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { Notification, OpsNotification } from '@/lib/types';

/**
 * O4, the second half: a badge that says something arrived.
 *
 * Push already reaches the tray when the app is closed, and now reaches it when the app is
 * open too — but a notification is a moment, and a moment is easy to miss. Nothing in the
 * app ever said "there is something you have not read", so a customer who swiped the tray
 * away had no way back to it except remembering the screen exists.
 *
 * ponytail: read-state is the same single `lastSeen` timestamp the inbox already keeps in
 * localStorage — the crm notifications table is an append-only audit trail with no per-row
 * read flag for customers. That means the badge is per-device, which is the same promise
 * the inbox has always made. A server flag is the upgrade if cross-device sync is ever
 * asked for, and it would replace this whole file rather than extend it.
 */
export const LAST_SEEN_KEY = 'hydromart.notifications.lastSeen';

/** Marks everything up to now as seen. Called by the inbox when it renders. */
export function markNotificationsSeen(at: string = new Date().toISOString()): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, at);
    // Same-document listeners: `storage` only fires in OTHER tabs, so the badge in this
    // one would keep its count until a reload without this.
    window.dispatchEvent(new Event(SEEN_EVENT));
  } catch {
    // Private mode, or storage disabled. A badge that cannot remember is a badge that
    // stays on — annoying, never wrong.
  }
}

const SEEN_EVENT = 'hydromart:notifications-seen';

/**
 * How many notifications arrived after the last visit to the inbox.
 *
 * Zero when signed out, when the read fails, or when nothing is new — the caller renders
 * nothing for zero. Deliberately NOT polled on a timer: it refreshes when the app comes
 * back to the foreground and when a push lands, which is when the answer can change.
 */
export function useUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let alive = true;

    const read = () => {
      void api
        .get<Notification[]>(endpoints.notifications.me, true)
        .then((rows) => {
          if (!alive) return;
          const lastSeen = localStorage.getItem(LAST_SEEN_KEY) ?? '';
          setCount(rows.filter((n) => n.createdAt > lastSeen).length);
        })
        .catch(() => {
          // A badge is not worth an error state. Silence here means "no news", which is
          // the same thing the screen showed before this existed.
        });
    };

    read();
    const onSeen = () => setCount(0);
    const onVisible = () => document.visibilityState === 'visible' && read();
    window.addEventListener(SEEN_EVENT, onSeen);
    window.addEventListener('hydromart:push-received', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener(SEEN_EVENT, onSeen);
      window.removeEventListener('hydromart:push-received', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return count;
}

/**
 * The ops half of the same badge.
 *
 * Different mechanism on purpose: an operational alert HAS a per-row read receipt on the
 * server (per staff member), so this counts unread rows rather than comparing timestamps.
 * A depot phone and a depot desktop therefore agree, which is what an alert about stock
 * needs and what a customer's own inbox does not.
 */
export function useOpsUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let alive = true;
    const read = () => {
      void api
        .get<OpsNotification[]>(endpoints.notifications.ops, true)
        .then((rows) => alive && setCount(rows.filter((n) => n.readAt == null).length))
        .catch(() => {
          // Same rule as the customer badge: a badge is not worth an error state.
        });
    };
    read();
    const onVisible = () => document.visibilityState === 'visible' && read();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hydromart:push-received', read);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hydromart:push-received', read);
    };
  }, [enabled]);

  return count;
}
