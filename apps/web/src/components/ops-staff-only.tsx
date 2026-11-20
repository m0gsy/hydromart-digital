'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth-context';
import { isOpsApp } from '@/lib/platform';

/**
 * The Ops app keeps no customer session: one is signed out and sent to the login with the
 * reason. Every way in passes here — a session from before the staff-only login, a signup
 * through /register, a phone HR has since moved to the staff account — so this is the one place
 * that has to know, rather than each of those doors. Renders nothing; does nothing on the web.
 *
 * Judged only once `ready`, i.e. after the boot re-read of `/auth/me`: HR inviting a customer
 * promotes that same account to staff, and the profile cached on the phone still says CUSTOMER
 * until the server is asked.
 */
export function OpsStaffOnly() {
  const { customer, ready, signOut } = useAuth();
  const router = useRouter();
  const notStaff = ready && isOpsApp() && customer?.role === 'CUSTOMER';
  useEffect(() => {
    if (!notStaff) return;
    signOut();
    router.replace('/login?reason=not-staff');
  }, [notStaff, signOut, router]);
  return null;
}
