'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isConsolePath } from '@/lib/roles';

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
      const door = isConsolePath(pathname) ? '/hq/login' : '/login';
      router.replace(`${door}?next=${encodeURIComponent(pathname)}`);
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
