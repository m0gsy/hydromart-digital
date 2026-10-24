'use client';

import { InsightDashboard } from '@/components/insight/insight-dashboard';

// The tabbed dashboard for head office. The rail row and the layout gate resolve the same
// capability (`dashboardFinance`); each widget inside is gated by its own endpoint's.
export default function HqDashboardPage() {
  return <InsightDashboard />;
}
