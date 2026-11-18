'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Flow PR-3d: a route that was merged into another stays alive as this, in every build. An
 * installed APK, a bookmark or a push can still name the old path; it lands on the new one
 * instead of on nothing.
 */
export function RouteRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
