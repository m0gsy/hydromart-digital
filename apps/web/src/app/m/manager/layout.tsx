'use client';

import { usePathname } from 'next/navigation';

import { NoDepotScopeNotice } from '@/components/dashboard/all-depots-notice';
import { OpsPushPrompt } from '@/components/dashboard/ops-push';
import { ManagerShell } from '@/components/manager-mobile/manager-shell';
import { RequireAuth } from '@/components/require-auth';
import { DepotProvider } from '@/lib/depot-context';
import { normalisePath } from '@/lib/screen-chrome';

/**
 * Depot Manager Mobile route layout. Every screen sits behind sign-in, gets the depot
 * switcher context, and the manager phone shell — EXCEPT the OTP login (cell 1a), which
 * is the pre-auth entry point and must render bare.
 */
export default function ManagerMobileLayout({ children }: { children: React.ReactNode }) {
  // The Ops APK hands over `/m/manager/login/`: compare the normalised path, or the OTP login
  // lands behind the sign-in wall and the approval detail gets a tab bar over its footer.
  const pathname = normalisePath(usePathname() ?? '');
  if (pathname === '/m/manager/login') return <>{children}</>;
  // Approval detail (cell 1d) owns the whole screen with its own sticky action footer.
  const fullBleed = /^\/m\/manager\/approvals\/[^/]+$/.test(pathname);
  return (
    <RequireAuth>
      <DepotProvider>
        <OpsPushPrompt />
        <ManagerShell nav={!fullBleed}>
          <NoDepotScopeNotice className="mx-4 mt-4" />
          {children}
        </ManagerShell>
      </DepotProvider>
    </RequireAuth>
  );
}
