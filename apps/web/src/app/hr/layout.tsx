'use client';

import { usePathname } from 'next/navigation';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { HrRail } from '@/components/hr/hr-rail';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { DepotProvider } from '@/lib/depot-context';
import { canViewHr } from '@/lib/roles';

// HR (HRIS Lite) console shell — mirrors the HQ layout. Gated to hrView (HR / HEAD_OFFICE /
// FINANCE / MANAGER / SUPER_ADMIN); depot managers are depot-scoped server-side.
// The /hr/me self-service PWA renders bare (its own gate is "linked employee", not hrView).
function HrGate({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  if (!canViewHr(customer?.role)) return <AccessDeniedHq role={customer?.role} />;
  return <>{children}</>;
}

export default function HrLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Self-service PWA: gated only by "signed in" (ownership is enforced in-service via
  // authSubjectId). A courier/operator checking in is not HR staff, so no rail, no hrView.
  // No rail here, so it carries the page padding the shop <main> used to give it.
  if (pathname.startsWith('/hr/me'))
    return (
      <RequireAuth>
        <div className="mx-auto w-full max-w-[1216px] px-4 pb-10 pt-6 sm:px-8">{children}</div>
      </RequireAuth>
    );

  // DepotProvider, because nine HR pages (employee/asset import, departemen, shift,
  // pelanggan, reseller, pengumuman, kinerja, aset) read the depot list to turn a depot
  // CODE in a spreadsheet into an id. Without it useDepot() throws and the page never
  // renders — HR is network-wide, but it still has to NAME depots.
  // Not on /hr/me above: self-service carries no depot picker and would only pay for the fetch.
  return (
    <RequireAuth>
      <HrGate>
        <DepotProvider>
          <div className="flex">
            <HrRail />
            <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">{children}</div>
          </div>
        </DepotProvider>
      </HrGate>
    </RequireAuth>
  );
}
