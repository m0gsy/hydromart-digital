'use client';

import { RouteRedirect } from '@/components/route-redirect';

// Flow PR-3d: merged into /dashboard/settings, whose top is this read view now.
export default function DepotSettingsPage() {
  return <RouteRedirect to="/dashboard/settings" />;
}
