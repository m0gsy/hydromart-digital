'use client';

import { RouteRedirect } from '@/components/route-redirect';

// Flow PR-3d: merged into /dashboard/account (who you are, your depot, your access, sign out).
export default function ProfilePage() {
  return <RouteRedirect to="/dashboard/account" />;
}
