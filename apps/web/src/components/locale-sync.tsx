'use client';

import { useEffect, useRef } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { LOCALE_STORAGE_KEY, useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';

/**
 * K5.3, the half that only ran on one screen.
 *
 * The language belongs to the person, not to the phone they chose it on — so a device that
 * has never been asked should adopt the stored answer. That adoption existed, and it lived
 * inside `/account`, next to the fetch that happens to load the preferences there. So it
 * fired only if the second device visited that screen.
 *
 * Measured in a browser against the live stack: a signed-in customer whose stored locale is
 * `en` (written by the switch on another device, confirmed in
 * `notification_preferences.locale`) opened `/orders` with no local key and got
 * `<html lang="id">` and an Indonesian nav — while the order notification for the same
 * person rendered in English, because crm-service reads the row and the browser did not.
 * The schema comment for that column warns about exactly this failure in the other
 * direction; this is the same defect with the sides swapped.
 *
 * Mounted in the root layout, inside both providers it needs, so the answer arrives before
 * the reader goes looking for it.
 *
 * Customers only: the row is theirs. Staff consoles carry the same switch and have no row
 * of their own to read, so asking on their behalf would be one request per session for a
 * value that is always the default.
 *
 * `LOCALE_STORAGE_KEY` present means THIS device has already answered, and a choice made
 * here must never be undone by the server's older copy on the next paint. `setLocale`
 * persists, so the adoption itself answers for the device — the same semantics the
 * `/account` version had, deliberately unchanged.
 */
export function LocaleSync(): null {
  const { customer, ready } = useAuth();
  const { setLocale } = useT();
  const asked = useRef(false);

  useEffect(() => {
    if (!ready || customer == null || asked.current) return;
    if (isStaff(customer.role)) return;
    try {
      if (localStorage.getItem(LOCALE_STORAGE_KEY)) return;
    } catch {
      // Storage disabled. Reading the row would be right, but we could not remember the
      // answer, so every navigation would re-ask. Leave the bundled default alone.
      return;
    }
    asked.current = true;
    void api
      .get<{ locale?: string }>(endpoints.preferences.notifications, true)
      .then((prefs) => {
        if (prefs?.locale === 'en' || prefs?.locale === 'id') setLocale(prefs.locale);
      })
      .catch(() => {
        // A language preference is not worth an error state; the bundled dictionary stands.
      });
  }, [ready, customer, setLocale]);

  return null;
}
