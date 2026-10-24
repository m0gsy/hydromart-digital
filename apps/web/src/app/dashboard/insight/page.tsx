'use client';

import { InsightDashboard } from '@/components/insight/insight-dashboard';

// The same dashboard inside the depot console. Nothing above this page gates a /dashboard
// route, so the gate is the dashboard's own: it opens only the tabs the role holds a
// capability for and shows a denied state when there are none.
export default function DashboardInsightPage() {
  return <InsightDashboard />;
}
