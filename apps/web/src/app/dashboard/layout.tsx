'use client';

import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';
import { OpsRail } from '@/components/dashboard/ops-rail';
import { RequireAuth } from '@/components/require-auth';
import { DepotProvider } from '@/lib/depot-context';

// Ops console shell: a persistent left rail (grouped by job-to-be-done) + a global
// depot switcher, sitting under the app's top nav. Negative margins pull the rail
// to the container edge; content re-adds the page padding. Rail is desktop-only —
// mobile keeps the existing full-width flow.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <DepotProvider>
        <div className="-mx-4 -mt-6 -mb-24 flex sm:-mx-8 sm:-mb-10">
          <OpsRail />
          <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">{children}</div>
        </div>
        <OpsBottomNav />
      </DepotProvider>
    </RequireAuth>
  );
}
