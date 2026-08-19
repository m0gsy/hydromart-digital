'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { staffDoor } from '@/lib/roles';

/**
 * Gate a page behind sign-in, sending the visitor to the door that matches the surface:
 * the staff console door for console routes, the customer one for the shop. Both carry
 * the return path. This is the only login redirect in the app.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { customer, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !customer) {
      const door = staffDoor(pathname);
      // E2: the return path has to include the query string. Since F1 every dynamic
      // segment is a query parameter — `/orders/detail?id=ord-1` — and `usePathname()`
      // never carries one, so the way back from the login door was `/orders/detail` with
      // no order named. That is the tapped-notification path on a phone that locked
      // itself: every one of those links died at sign-in and landed on an empty screen.
      //
      // Read off `window.location` rather than `useSearchParams()`: this component wraps
      // most of the app, and that hook forces a Suspense boundary that would make every
      // statically exported page render as its fallback. Inside an effect, so it only
      // ever runs on the client. `staffDoor` still takes the path alone — which door you
      // are sent to is decided by the route, not by its parameters.
      const search = typeof window === 'undefined' ? '' : window.location.search;
      router.replace(`${door}?next=${encodeURIComponent(`${pathname}${search}`)}`);
    }
  }, [ready, customer, router, pathname]);

  if (!ready || !customer) {
    return (
      <div className="flex justify-center py-24 text-brand-500">
        <Spinner size={28} />
      </div>
    );
  }
  return <>{children}</>;
}
