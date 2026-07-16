'use client';

import { usePathname } from 'next/navigation';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { HqBottomNav } from '@/components/hq/hq-bottom-nav';
import { HqRail } from '@/components/hq/hq-rail';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { isHq } from '@/lib/roles';

// HQ console shell: a persistent left rail (network-wide, no depot switcher) under the
// app top nav, mirroring the ops dashboard layout. There is NO DepotProvider — HQ is
// network-scoped. The whole tree is gated to HEAD_OFFICE / SUPER_ADMIN (design 20c);
// /hq/login is the way in, so it renders bare (outside the auth + HQ gate).
function HqGate({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  if (!isHq(customer?.role)) return <AccessDeniedHq role={customer?.role} />;
  return <>{children}</>;
}

export default function HqLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/hq/login') return <>{children}</>;

  return (
    <RequireAuth>
      <HqGate>
        <div className="-mx-4 -mt-6 -mb-24 flex sm:-mx-8 sm:-mb-10">
          <HqRail />
          <div className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 sm:pb-10">{children}</div>
        </div>
        <HqBottomNav />
      </HqGate>
    </RequireAuth>
  );
}
