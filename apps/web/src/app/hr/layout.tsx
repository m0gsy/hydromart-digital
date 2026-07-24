'use client';

import { usePathname } from 'next/navigation';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { HrRail } from '@/components/hr/hr-rail';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { canViewHr } from '@/lib/roles';

// HR (HRIS Lite) console shell — mirrors the HQ layout. Gated to hrView (HR / HEAD_OFFICE /
// FINANCE / DEPOT_MANAGER / SUPER_ADMIN); depot managers are depot-scoped server-side.
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
  if (pathname.startsWith('/hr/me')) return <RequireAuth>{children}</RequireAuth>;

  return (
    <RequireAuth>
      <HrGate>
        <div className="-mx-4 -mt-6 -mb-24 flex sm:-mx-8 sm:-mb-10">
          <HrRail />
          <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">{children}</div>
        </div>
      </HrGate>
    </RequireAuth>
  );
}
