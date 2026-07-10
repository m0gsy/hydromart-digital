'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

/** Gate a page behind sign-in; redirect to /login with a return path. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { customer, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !customer) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
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
