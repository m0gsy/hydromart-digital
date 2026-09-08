'use client';

import { useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useToast } from '@/components/toast';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { AdminNotificationPrefs, NotificationChannelPref } from '@/lib/types';

/**
 * The depot consoles' notification switches, backed by the same admin-service row the HQ
 * matrix edits (`GET/PUT /notification-prefs`, keyed by the caller's own account).
 *
 * These screens offer ONE switch per event where the server carries three channels. The
 * switch is `push` — the channel a depot phone actually uses — and `email`/`wa` are written
 * back untouched, so flipping a toggle here can never silently unsubscribe somebody from a
 * channel this screen does not show.
 *
 * The toggles used to be `useState` with a "TODO persist" comment: they moved, looked saved,
 * and were back to their defaults on the next reload.
 */
export function usePushPrefs() {
  const { toast } = useToast();
  const { t } = useT();
  const query = useAsync<AdminNotificationPrefs>(() => api.get(endpoints.admin.notifPrefs, true));
  const [rows, setRows] = useState<NotificationChannelPref[] | null>(null);

  const events = rows ?? query.data?.events ?? [];

  /** `undefined` while the read is in flight or failed — the caller decides what to render. */
  const isOn = (id: string): boolean | undefined => events.find((e) => e.id === id)?.push;

  async function setOn(id: string, value: boolean, label: string): Promise<void> {
    const current = events.find((e) => e.id === id);
    if (!current) return;
    const next = events.map((e) => (e.id === id ? { ...e, push: value } : e));
    setRows(next);
    try {
      const saved = await api.put<AdminNotificationPrefs>(
        endpoints.admin.notifPrefs,
        { events: next },
        true,
      );
      setRows(saved.events);
    } catch (err) {
      // Roll the switch back: a toggle that stays where it was put is a preference the user
      // believes is saved.
      setRows(events);
      toast(err instanceof ApiError ? err.message : t('hrFix.notifPrefs.saveFailed', { label }), 'error');
    }
  }

  return { isOn, setOn, loading: query.loading, error: query.error, reload: query.reload };
}

/*
 * CA-4-50 — the COURIER's notification switches wrote to `localStorage` and nothing on
 * either side of the wire ever read them. "Jangan ganggu" included: a courier could turn
 * every switch off and the phone kept ringing exactly as before.
 *
 * They are device-local by design (see the K5.1 note on `/driver/settings`), so unlike the
 * account-scoped hook above these never reach a server. The thing that decides whether a
 * notification appears is `public/sw.js`, and a service worker cannot see `localStorage` —
 * it is not even running in a window. So the prefs are mirrored into the Cache API, which
 * BOTH sides can reach and which survives the page being closed, the state the worker
 * usually wakes up in.
 *
 * `localStorage` stays what the screen renders from: it reads synchronously, so the
 * switches paint in their real position on first frame instead of flickering.
 */
export const NOTIF_PREF_KEY = 'hydromart_driver_notif_prefs';

/** Must match `PREF_CACHE` / `PREF_URL` in `public/sw.js`. */
const PREF_CACHE = 'hydromart-notif-prefs';
const PREF_URL = '/__notif-prefs';

/** Mirrors the courier prefs where the service worker can read them. Never throws. */
export async function publishNotifPrefs(prefs: Record<string, boolean>): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(PREF_CACHE);
    await cache.put(PREF_URL, new Response(JSON.stringify(prefs)));
  } catch {
    /*
     * A phone with storage full, or a browser with site data blocked, must not break the
     * switch the courier just tapped. The worst case is the previous behaviour —
     * notifications keep coming through — which is the safe direction to fail.
     */
  }
}
