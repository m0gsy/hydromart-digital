'use client';

import { OperatorShell } from '@/components/operator/operator-shell';
import { OpsPushPrompt } from '@/components/dashboard/ops-push';
import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';
import { AllDepotsNotice } from '@/components/dashboard/all-depots-notice';
import { OpsRail } from '@/components/dashboard/ops-rail';
import { RequireAuth } from '@/components/require-auth';
import { DepotProvider } from '@/lib/depot-context';
import { useAuth } from '@/lib/auth-context';
import { useWallScreen } from '@/lib/insight/wall-screen';
import { isDepotOperator } from '@/lib/roles';

// Ops console shell, role-aware. KEPALA_DEPOT gets the top-tab operator console
// (design: Depot Operator.dc.html); every other staff role keeps the grouped left
// rail + global depot switcher (design: Depot Manager.dc.html cell 6a). Both live
// under /dashboard/* and share DepotProvider/RequireAuth.
function ConsoleFrame({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  const wall = useWallScreen();

  // The wall-screen view: the figures and nothing around them.
  if (wall) return <div className="px-6 py-6">{children}</div>;

  if (isDepotOperator(customer?.role)) {
    return <OperatorShell>{children}</OperatorShell>;
  }

  return (
    <>
      <div className="flex">
        <OpsRail />
        <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">
          <AllDepotsNotice />
          {children}
        </div>
      </div>
      <OpsBottomNav />
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <DepotProvider>
        <OpsPushPrompt />
        <ConsoleFrame>{children}</ConsoleFrame>
      </DepotProvider>
    </RequireAuth>
  );
}
