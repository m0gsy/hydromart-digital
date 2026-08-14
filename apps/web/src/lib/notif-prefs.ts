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
