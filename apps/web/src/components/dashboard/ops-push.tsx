'use client';

import { Bell } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { useToast } from '@/components/toast';
import { Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';
import {
  getPushState,
  requestPushOnce,
  subscribeToPush,
  unsubscribeFromPush,
  type PushState,
} from '@/lib/push';

/**
 * Registers this phone for push the first time a staff account opens the ops console.
 *
 * Until now only a customer (after a first order) and a courier (at check-in) ever
 * registered a device, so `DEPOT_ORDER_INCOMING` and every other depot alert found no token
 * for a depot head or manager and reached nobody. Native shell only, and once per install
 * until sign-out — `requestPushOnce` owns both rules, because Android turns a second ask
 * into a permanent denial. Keyed by account so a second person signing in on the same phone
 * is registered too (sign-out forgets the ask).
 */
export function OpsPushPrompt() {
  const { customer } = useAuth();
  const accountId = customer?.id;
  const staff = isStaff(customer?.role);
  useEffect(() => {
    // A customer who typed /dashboard is turned away by the page; they must not be asked.
    if (accountId && staff) void requestPushOnce();
  }, [accountId, staff]);
  return null;
}

/**
 * The device's real push state as a switch, for the staff settings screens. Their other
 * switches store per-event preferences; none of them registers the phone, so a staff member
 * who refused the first dialog had no way to turn it back on from inside the app.
 */
export function DevicePushRow() {
  const { t } = useT();
  const { toast } = useToast();
  const [state, setState] = useState<PushState | null>(null);

  useEffect(() => {
    let alive = true;
    void getPushState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState('unsupported'));
    return () => {
      alive = false;
    };
  }, []);

  if (state === null || state === 'unsupported') return null;

  async function toggle(value: boolean) {
    const before = state;
    setState(value ? 'subscribed' : 'unsubscribed'); // optimistic
    try {
      const next = value ? await subscribeToPush() : await unsubscribeFromPush();
      setState(next);
      if (value && next !== 'subscribed') {
        toast(
          t(next === 'denied' ? 'dashA.account.devicePush.denied' : 'dashA.account.devicePush.failed'),
          'error',
        );
      }
    } catch {
      setState(before);
      toast(t('dashA.account.devicePush.failed'), 'error');
    }
  }

  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Bell size={18} weight="fill" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{t('dashA.account.devicePush.label')}</p>
        <p className="text-[11px] text-[color:var(--text-muted)]">
          {t('dashA.account.devicePush.sub')}
        </p>
      </div>
      <Toggle
        on={state === 'subscribed'}
        onChange={(v) => void toggle(v)}
        label={t('dashA.account.devicePush.label')}
      />
    </div>
  );
}
