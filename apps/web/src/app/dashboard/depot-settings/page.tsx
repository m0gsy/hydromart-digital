'use client';

import { RouteRedirect } from '@/components/route-redirect';

// Flow PR-3d: merged into /dashboard/settings, as its read mode.
export default function DepotSettingsPage() {
  return <RouteRedirect to="/dashboard/settings?mode=read" />;
}
