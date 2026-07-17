'use client';

import { OperatorShell } from '@/components/operator/operator-shell';
import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';
import { OpsRail } from '@/components/dashboard/ops-rail';
import { RequireAuth } from '@/components/require-auth';
import { DepotProvider } from '@/lib/depot-context';
import { useAuth } from '@/lib/auth-context';
import { isDepotOperator } from '@/lib/roles';

// Ops console shell, role-aware. DEPOT_OPERATOR gets the top-tab operator console
// (design: Depot Operator.dc.html); every other staff role keeps the grouped left
// rail + global depot switcher (design: Depot Manager.dc.html cell 6a). Both live
// under /dashboard/* and share DepotProvider/RequireAuth.
function ConsoleFrame({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();

  if (isDepotOperator(customer?.role)) {
    return <OperatorShell>{children}</OperatorShell>;
  }

  return (
    <>
      <div className="-mx-4 -mt-6 -mb-24 flex sm:-mx-8 sm:-mb-10">
        <OpsRail />
        <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">{children}</div>
      </div>
      <OpsBottomNav />
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <DepotProvider>
        <ConsoleFrame>{children}</ConsoleFrame>
      </DepotProvider>
    </RequireAuth>
  );
}
