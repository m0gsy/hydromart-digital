'use client';

import { usePathname } from 'next/navigation';

import { ManagerShell } from '@/components/manager-mobile/manager-shell';
import { RequireAuth } from '@/components/require-auth';
import { DepotProvider } from '@/lib/depot-context';

/**
 * Depot Manager Mobile route layout. Every screen sits behind sign-in, gets the depot
 * switcher context, and the manager phone shell — EXCEPT the OTP login (cell 1a), which
 * is the pre-auth entry point and must render bare.
 */
export default function ManagerMobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/m/manager/login') return <>{children}</>;
  // Approval detail (cell 1d) owns the whole screen with its own sticky action footer.
  const fullBleed = /^\/m\/manager\/approvals\/[^/]+$/.test(pathname);
  return (
    <RequireAuth>
      <DepotProvider>
        <ManagerShell nav={!fullBleed}>{children}</ManagerShell>
      </DepotProvider>
    </RequireAuth>
  );
}
