'use client';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { canViewResellers } from '@/lib/roles';

// Top-level route (not under /hq) so depot managers can reach it — gated to
// canViewResellers (HQ + depot managers); managers are depot-scoped server-side.
function ResellerGate({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  if (!canViewResellers(customer?.role)) return <AccessDeniedHq role={customer?.role} />;
  return <>{children}</>;
}

export default function ResellersLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <ResellerGate>
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">{children}</div>
      </ResellerGate>
    </RequireAuth>
  );
}
