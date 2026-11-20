'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { isCustomerApp, isOpsApp } from '@/lib/platform';
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
 * Why a session with this role does not belong in this binary, as the login's `reason`, or null
 * when it does. Staff use the Ops app and customers the customer app; the web serves everyone.
 */
function wrongApp(role: string): 'not-staff' | 'staff-account' | null {
  if (isOpsApp()) return role === 'CUSTOMER' ? 'not-staff' : null;
  if (isCustomerApp()) return role === 'CUSTOMER' ? null : 'staff-account';
  return null;
}

/**
 * Each app keeps its own people (owner decisions 2026-11-20), and this is the one place that
 * knows, rather than every door a session or a visitor can come through. Renders nothing; does
 * nothing on the web.
 *
 * - A session in the wrong app — a customer in Ops (from before the staff-only login, or a phone
 *   HR has since moved to the staff account), staff in the customer app (which carries none of
 *   their consoles) — is sent to the login with the reason, and signed out once there. Navigate
 *   first, sign out second: signing out first let the signed-out rule race the redirect and drop
 *   the reason.
 * - The Ops app has no signup: `/register` still ships in the bundle, so it is sent to the
 *   login, signed in or not — a signup there is exactly the customer account Ops must not mint.
 * - A signed-out Ops visitor is sent to the login instead of the customer catalog. Console
 *   screens are left to RequireAuth, which carries the way back in `next`.
 *
 * The role is acted on only when the server confirms it. The profile cached on the phone can be
 * stale — HR inviting a customer promotes that same account to staff — and offline the boot
 * re-read fails and leaves the cache in place, so no answer means no action. Waiting for `ready`
 * also keeps the request behind the Keystore unlock.
 */
export function AppAudienceGate() {
  const { customer, ready, signOut } = useAuth();
  const router = useRouter();
  const path = normalisePath(usePathname() ?? '/');
  const ops = isOpsApp();
  const signedOutAway =
    ops && ready && !customer && !OPEN_SIGNED_OUT.has(path) && !isConsolePath(path);
  const suspect = ready && customer ? wrongApp(customer.role) : null;

  useEffect(() => {
    if ((ops && path === '/register') || signedOutAway) router.replace('/login');
  }, [ops, path, signedOutAway, router]);

  useEffect(() => {
    if (!suspect) return;
    let live = true;
    api
      .get<Customer>(endpoints.auth.me, true)
      .then((fresh) => {
        if (!live || wrongApp(fresh.role) !== suspect) return;
        if (path === '/login') signOut();
        else router.replace(`/login?reason=${suspect}`);
      })
      .catch(() => {
        /* no answer, no action: the next foreground re-check tries again */
      });
    return () => {
      live = false;
    };
  }, [suspect, path, signOut, router]);

  return null;
}
