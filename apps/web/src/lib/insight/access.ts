/**
 * Which dashboard tabs a role can open, decided from the capabilities it already holds.
 *
 * There is no capability of its own for the dashboard on purpose: each widget is gated by the
 * capability of the endpoint behind it (`can(cap, role)`, which reads the list the server
 * sent with the session), so the screen and the server cannot disagree about who sees what. A
 * tab is shown when ANY of its widgets is allowed; a widget the server then refuses anyway
 * (a per-depot override, say) renders as nothing rather than as a page-level error.
 */
import { can, type Capability } from '@/lib/roles';

export type InsightTabId =
  | 'overview'
  | 'sales'
  | 'operations'
  | 'customers'
  | 'finance'
  | 'gallons'
  | 'people'
  | 'cash'
  | 'couriers'
  | 'meter'
  | 'time'
  | 'stock'
  | 'risk';

export interface InsightTabDef {
  id: InsightTabId;
  /** i18n key under `insight.tabs.*`. */
  labelKey: string;
  /** The capabilities its widgets need. A role holding any one of them sees the tab. */
  caps: readonly Capability[];
}

export const INSIGHT_TABS: readonly InsightTabDef[] = [
  {
    id: 'overview',
    labelKey: 'insight.tabs.overview',
    caps: ['dashboardFinance', 'orderReports', 'depotTargets'],
  },
  {
    id: 'sales',
    labelKey: 'insight.tabs.sales',
    caps: ['orderReports', 'settlementRead', 'dashboardFinance'],
  },
  {
    id: 'operations',
    labelKey: 'insight.tabs.operations',
    caps: ['dashboardFinance', 'orderReports', 'orderReportsDepot', 'inventoryRead'],
  },
  {
    id: 'customers',
    labelKey: 'insight.tabs.customers',
    caps: ['depotCrm', 'loyaltyRead', 'voucherRead', 'churn', 'hqBackOffice', 'orderReports'],
  },
  {
    id: 'finance',
    labelKey: 'insight.tabs.finance',
    caps: ['dashboard', 'settlementRead', 'refundQueueRead'],
  },
  { id: 'gallons', labelKey: 'insight.tabs.gallons', caps: ['returnsRead', 'returnsReadFinance'] },
  { id: 'people', labelKey: 'insight.tabs.people', caps: ['hrView'] },
  {
    id: 'cash',
    labelKey: 'insight.tabs.cash',
    caps: ['cashierShift', 'orderReportsDepot', 'depotFinance', 'dailyClose'],
  },
  {
    id: 'couriers',
    labelKey: 'insight.tabs.couriers',
    caps: ['trackingRead', 'deliveryReports', 'courierSettle'],
  },
  { id: 'meter', labelKey: 'insight.tabs.meter', caps: ['meterRead'] },
  { id: 'time', labelKey: 'insight.tabs.time', caps: ['orderReports'] },
  { id: 'stock', labelKey: 'insight.tabs.stock', caps: ['inventoryRead', 'procurement'] },
  {
    id: 'risk',
    labelKey: 'insight.tabs.risk',
    caps: ['incidents', 'depotDisputes', 'approvals', 'depotMaintenance'],
  },
];

type Role = string | null | undefined;

export function visibleTabs(role: Role): InsightTabDef[] {
  return INSIGHT_TABS.filter((tab) => tab.caps.some((cap) => can(cap, role)));
}

/**
 * Roles whose own screens say more than this dashboard does. A human-resources account and a
 * franchise owner reach only a tab or two here, and their full views already exist.
 */
export function fullDetailLink(role: Role): { href: string; labelKey: string } | null {
  if (role === 'HR') return { href: '/hr', labelKey: 'insight.fullDetail.hr' };
  if (role === 'FRANCHISE_OWNER') {
    return { href: '/dashboard/franchise', labelKey: 'insight.fullDetail.franchise' };
  }
  return null;
}

/** Whether the role has anything to see at all: the question the nav rows ask. */
export function canViewInsight(role: Role): boolean {
  return visibleTabs(role).length > 0;
}

/** The tab to open: the one asked for if the role may see it, else the first it may. */
export function resolveTab(role: Role, requested: string): InsightTabDef | null {
  const tabs = visibleTabs(role);
  return tabs.find((t) => t.id === requested) ?? tabs[0] ?? null;
}
