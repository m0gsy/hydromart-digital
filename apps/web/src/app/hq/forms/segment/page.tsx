'use client';

import { RouteRedirect } from '@/components/route-redirect';

// Flow plan 5c: saved and hand-built segments are the audience step of the campaign builder.
export default function HqSegmentFormPage() {
  return <RouteRedirect to="/hq/campaigns" />;
}
