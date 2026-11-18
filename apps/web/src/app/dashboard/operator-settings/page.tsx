'use client';

import { RouteRedirect } from '@/components/route-redirect';

// Flow PR-3d: merged into /dashboard/account, which carries the operator's alerts and the way
// out that this screen had.
export default function OperatorSettingsPage() {
  return <RouteRedirect to="/dashboard/account" />;
}
