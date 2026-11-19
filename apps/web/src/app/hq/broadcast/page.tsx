'use client';

import { RouteRedirect } from '@/components/route-redirect';

// Flow plan 5c: the broadcast composer is the campaign builder now (a depot's own customers
// are the depot condition of its audience step).
export default function HqBroadcastPage() {
  return <RouteRedirect to="/hq/campaigns" />;
}
