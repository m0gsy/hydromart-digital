'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { isOpsApp } from '@/lib/platform';
import { isConsolePath } from '@/lib/roles';
import { normalisePath } from '@/lib/screen-chrome';
import type { Customer } from '@/lib/types';

/** Where a signed-out visitor may stay in the Ops app: the sign-in doors and the legal pages. */
const OPEN_SIGNED_OUT = new Set([
  '/login',
  '/verify',
  '/syarat-ketentuan',
  '/kebijakan-privasi',
  '/hapus-akun',
]);

/**
 * The Ops app is staff-only (owner decisions 2026-11-20), and this is the one place that knows,
 * rather than every door a session or a visitor can come through. Renders nothing; does nothing
 * on the web or in the customer app.
 *
 * - There is no signup in it: `/register` still ships in the bundle, so it is sent to the login,
 *   signed in or not — a signup there is exactly the customer account this exists to prevent.
 * - A signed-out visitor is sent to the login instead of the customer catalog. Console screens
 *   are left to RequireAuth, which carries the way back in `next`.
 * - A CUSTOMER session — from before the staff-only login, a phone HR has since moved to the
 *   staff account — is sent to the login with the reason, and signed out once there. Navigate
 *   first, sign out second: signing out first let the signed-out rule race the redirect and drop
 *   the reason.
 *
 * The CUSTOMER role is acted on only when the server confirms it. The profile cached on the
 * phone can be stale — HR inviting a customer promotes that same account to staff — and offline
 * the boot re-read fails and leaves the cache in place, so no answer means no action. Waiting for
 * `ready` also keeps the request behind the Keystore unlock.
 */
export function OpsStaffOnly() {
  const { customer, ready, signOut } = useAuth();
  const router = useRouter();
  const path = normalisePath(usePathname() ?? '/');
  const ops = isOpsApp();
  const signedOutAway =
    ops && ready && !customer && !OPEN_SIGNED_OUT.has(path) && !isConsolePath(path);
  const customerSession = ops && ready && customer?.role === 'CUSTOMER';

  useEffect(() => {
    if ((ops && path === '/register') || signedOutAway) router.replace('/login');
  }, [ops, path, signedOutAway, router]);

  useEffect(() => {
    if (!customerSession) return;
    let live = true;
    api
      .get<Customer>(endpoints.auth.me, true)
      .then((fresh) => {
        if (!live || fresh.role !== 'CUSTOMER') return;
        if (path === '/login') signOut();
        else router.replace('/login?reason=not-staff');
      })
      .catch(() => {
        /* no answer, no action: the next foreground re-check tries again */
      });
    return () => {
      live = false;
    };
  }, [customerSession, path, signOut, router]);

  return null;
}
