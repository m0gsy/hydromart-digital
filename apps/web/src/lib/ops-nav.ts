// The depot-console navigation model: every screen the ops rail offers, the gate its row
// needs, grouped by job-to-be-done.
//
// Data, not a component (the `lib/hq-nav.ts` pattern). The desktop rail, the phone "Lainnya"
// sheet, the hub tabs, the operator console's "Kelola" tabs and `canOpenRoute` all read this
// one table; flow PR-3a moved it here from `components/dashboard/ops-rail.tsx`, so
// route-access no longer imports the rail component.
//
// Flow PR-3b: each group is a HUB. The rail shows one row per hub a role can see; the hub's
// screens are tabs across the top of each of them (`components/dashboard/hub-tabs.tsx`).

import { isServedHere } from '@/lib/deep-link';
import { normalisePath } from '@/lib/screen-chrome';
import { hasPartialHqDoor } from '@/lib/hq-nav';
import {
  canManageDepots,
  canRecordWalkInSale,
  canManagePricing,
  canManageStaff,
  canViewCampaigns,
  canViewCourierCommission,
  canViewMonthlyClose,
  canViewTeamPerformance,
  canManagePromoRules,
  canViewChurn,
  canViewDashboard,
  canViewForecast,
  canViewFranchise,
  canViewOwnAttendance,
  canViewInventory,
  canViewOpsNotifications,
  canApproveExpense,
  canManageEarningRules,
  canViewPayout,
  canViewReturns,
  canViewTracking,
  canViewVouchers,
  canVerifySettlement,
  canReviewApprovals,
  canManageProcurement,
  canViewIncidents,
  canViewAudit,
  canViewDepotCrm,
  canViewDepotFinance,
  canBroadcastToCouriers,
  canHandOverRewards,
  canPunchAttendance,
  canUseManagerConsole,
  isDepotOperator,
  canViewMeterReading,
  can,
  isHq,
  isStaff,
  canViewResellers,
  canViewPromotions,
} from '@/lib/roles';
import { canViewInsight } from '@/lib/insight/access';
import type { HubKey } from '@/lib/ops-hub-icons';

type Role = string | null | undefined;

export interface RailItem {
  href: string;
  // i18n key under ops.nav.* — resolved at render via t().
  labelKey: string;
  show: (role: Role) => boolean;
}
export interface RailGroup {
  // i18n key under ops.groups.* — resolved at render via t(). The hub's name (PR-3b).
  // The hub's row icon is HUB_ICONS[headKey] (lib/ops-hub-icons.ts), drawn by the rail and the
  // phone sheet only.
  headKey: HubKey;
  /** The hub's screens, in tab order. The first one a role may open is where its row leads. */
  items: RailItem[];
}

// Grouped by job-to-be-done. Each item is role-gated (chrome only — the server
// stays authoritative); groups with no visible items collapse.
// B2: exported so the phone "Lainnya" sheet renders the SAME menu the desktop rail does.
// One list, two surfaces — a second copy would drift the moment a route is added.
export const GROUPS: RailGroup[] = [
  {
    headKey: 'summary',
    items: [
      // PR-3b: the head of depot's /dashboard is their operator home, so it is a screen of this
      // hub for them too (the operator bar's Ringkasan stands for it). Narrower than the page
      // (dashboardLandingView), which also answers a franchise owner: their row stays Waralabaku.
      {
        href: '/dashboard',
        labelKey: 'operations',
        show: (role) => canViewDashboard(role) || isDepotOperator(role),
      },
      {
        href: '/dashboard/franchise',
        labelKey: 'myFranchise',
        show: canViewFranchise,
      },
      { href: '/dashboard/insight', labelKey: 'insight', show: canViewInsight },
      {
        href: '/dashboard/search',
        labelKey: 'search',
        show: (role) => can('depotDirectory', role),
      },
      { href: '/dashboard/forecast', labelKey: 'forecast', show: canViewForecast },
      {
        href: '/dashboard/notifications',
        labelKey: 'notifications',
        show: canViewOpsNotifications,
      },
      // The way back out. Console routes carry no shop nav, so without this an HQ account
      // that stepped into the depot console had no link home either — the same missing
      // door as the /dashboard entry in the HQ rail, in the other direction.
      //
      // Gated on the binary actually serving `/hq`: the Ops app prunes the whole HQ console,
      // so this door led an HQ account to a route that is not in the bundle — the S1 bug one
      // surface over. `consoleHome()` already falls through for the same reason.
      {
        href: '/hq',
        labelKey: 'hqConsole',
        // PR-3b: the overview is a `dashboard` screen (`capForHqPath`); a console role without
        // it (FINANCE) was offered a door to the one HQ page that refuses it. It gets the
        // next one instead: a screen it may open (its landing is its Keuangan hub, PR-3c).
        show: (role) => isHq(role) && can('dashboard', role) && isServedHere('/hq'),
      },
      {
        href: '/hq/search',
        labelKey: 'hqConsole',
        show: (role) =>
          isHq(role) &&
          !can('dashboard', role) &&
          can('depotDirectoryFinance', role) &&
          isServedHere('/hq/search'),
      },
      // MARKETING holds a partial door: a handful of /hq screens with no depot twin. The
      // overview is not among them, so this goes straight to the first one.
      {
        href: '/hq/campaigns',
        labelKey: 'hqConsole',
        // The Ops binary prunes /hq; the guard names the exact route the link goes to.
        show: (role) =>
          !isHq(role) && hasPartialHqDoor(role as never) && isServedHere('/hq/campaigns'),
      },
    ],
  },
  {
    headKey: 'orders',
    items: [
      // The page's own gate (`orders:511`), not `orderQueue`: FINANCE reads the queue to refund
      // and reconcile, and its rail had no door to it.
      {
        href: '/dashboard/orders',
        labelKey: 'orders',
        show: (role) => can('orderManageRead', role),
      },
      {
        href: '/dashboard/disputes',
        labelKey: 'disputes',
        show: (r) => can('depotDisputes', r),
      },
      {
        href: '/dashboard/subscriptions',
        labelKey: 'subscriptions',
        show: (r) => can('depotSubscriptions', r),
      },
    ],
  },
  {
    headKey: 'counter',
    items: [
      {
        href: '/dashboard/walk-in',
        labelKey: 'walkIn',
        show: canRecordWalkInSale,
      },
    ],
  },
  {
    headKey: 'tracking',
    items: [
      { href: '/dashboard/tracking', labelKey: 'tracking', show: canViewTracking },
    ],
  },
  {
    headKey: 'stock',
    items: [
      {
        href: '/dashboard/inventory',
        labelKey: 'inventory',
        show: canViewInventory,
      },
      { href: '/dashboard/returns', labelKey: 'returns', show: canViewReturns },
      { href: '/dashboard/wastage', labelKey: 'wastage', show: canUseManagerConsole },
      { href: '/dashboard/meter', labelKey: 'meter', show: canViewMeterReading },
    ],
  },
  {
    headKey: 'purchasing',
    items: [
      {
        href: '/dashboard/purchase-orders',
        labelKey: 'purchaseOrders',
        show: canManageProcurement,
      },
      {
        href: '/dashboard/suppliers',
        labelKey: 'suppliers',
        show: canManageProcurement,
      },
    ],
  },
  {
    headKey: 'cash',
    items: [
      {
        href: '/dashboard/settlements',
        labelKey: 'settlements',
        show: canVerifySettlement,
      },
      {
        href: '/dashboard/cashbook',
        labelKey: 'cashbook',
        show: canViewDepotFinance,
      },
      {
        href: '/dashboard/payment-recon',
        labelKey: 'paymentRecon',
        show: canViewDepotFinance,
      },
    ],
  },
  {
    headKey: 'approvals',
    items: [
      {
        href: '/dashboard/approvals',
        labelKey: 'approvalsQueue',
        show: canReviewApprovals,
      },
      {
        href: '/dashboard/incidents',
        labelKey: 'incidents',
        show: canViewIncidents,
      },
    ],
  },
  {
    headKey: 'customers',
    items: [
      {
        href: '/dashboard/customers',
        labelKey: 'customers',
        show: canViewDepotCrm,
      },
      { href: '/dashboard/crm', labelKey: 'crm', show: canViewDepotCrm },
      { href: '/dashboard/ratings', labelKey: 'ratings', show: canUseManagerConsole },
      {
        href: '/dashboard/recommendations',
        labelKey: 'recommendations',
        show: canManageDepots,
      },
    ],
  },
  {
    headKey: 'loyalty',
    items: [
      { href: '/dashboard/loyalty', labelKey: 'loyalty', show: canUseManagerConsole },
      {
        href: '/dashboard/redemptions',
        labelKey: 'redemptions',
        show: canHandOverRewards,
      },
      { href: '/dashboard/referral', labelKey: 'referral', show: canUseManagerConsole },
    ],
  },
  {
    headKey: 'marketing',
    items: [
      // Banners have their own capability (and are head office's since 2026-11-17), not CRM's.
      {
        href: '/dashboard/promotions',
        labelKey: 'promo',
        show: canViewPromotions,
      },
      {
        href: '/dashboard/promo-rules',
        labelKey: 'promoRules',
        show: canManagePromoRules,
      },
      { href: '/dashboard/vouchers', labelKey: 'vouchers', show: canViewVouchers },
      {
        href: '/dashboard/campaigns',
        labelKey: 'campaign',
        show: canViewCampaigns,
      },
      { href: '/dashboard/churn', labelKey: 'churn', show: canViewChurn },
      /*
       * J10: the agen registry had no door for the role that owns it. `/resellers` was
       * linked from the HQ rail only — a rail a depot manager never sees — while the
       * capability that opens the screen (`resellerView`) is theirs. Reachable by typing
       * the URL is the same as not existing.
       */
      { href: '/resellers', labelKey: 'resellers', show: canViewResellers },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      {
        href: '/dashboard/products/manage',
        labelKey: 'manageProducts',
        show: canManageDepots,
      },
      { href: '/dashboard/pricing', labelKey: 'pricing', show: canManagePricing },
      { href: '/dashboard/wholesale', labelKey: 'wholesale', show: canManagePricing },
    ],
  },
  {
    headKey: 'commission',
    items: [
      {
        href: '/dashboard/commission',
        labelKey: 'commission',
        show: canViewCourierCommission,
      },
      {
        href: '/dashboard/earning-rules',
        labelKey: 'earningRules',
        show: canManageEarningRules,
      },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/dashboard/payout', labelKey: 'payout', show: canViewPayout },
      {
        href: '/dashboard/expense-claims',
        labelKey: 'expenseClaims',
        show: canApproveExpense,
      },
      {
        href: '/dashboard/reports',
        labelKey: 'reports',
        show: (role) => can('orderReportsDepot', role),
      },
      // Owner decision 2026-11-20: the history import had a door on the head-office export
      // screen only, so the managers and franchise owners who hold it had none at all.
      {
        href: '/dashboard/sales-import',
        labelKey: 'salesImport',
        show: (role) => can('salesImportAdmin', role),
      },
      {
        href: '/dashboard/monthly-review',
        labelKey: 'monthlyReview',
        show: canViewMonthlyClose,
      },
      // Built, gated and unreachable: nothing in any nav pointed at these two, so the only
      // way in was to type the URL. `canViewDashboard` is the gate each page enforces.
      {
        href: '/dashboard/monthly-pnl',
        labelKey: 'monthlyPnl',
        show: canViewDashboard,
      },
      { href: '/dashboard/compare', labelKey: 'compare', show: canUseManagerConsole },
    ],
  },
  {
    headKey: 'team',
    items: [
      { href: '/dashboard/staff', labelKey: 'staff', show: canManageStaff },
      {
        href: '/dashboard/franchise/attendance',
        labelKey: 'ownerAttendance',
        show: canViewOwnAttendance,
      },
      {
        href: '/dashboard/team-performance',
        labelKey: 'teamPerformance',
        show: canViewTeamPerformance,
      },
      // The roster read (`GET /rosters`) is guarded by `driverRoster` on the server, so the door
      // follows it: with `isStaff` here Supervisor, Finance, Marketing and the Franchise Owner got a
      // menu entry that opened a screen of "You do not have permission" (found in the user-guide run).
      // `isStaff` still gates the two items below.
      {
        href: '/dashboard/shift',
        labelKey: 'shift',
        show: (r) => can('driverRoster', r),
      },
      {
        href: '/dashboard/targets',
        labelKey: 'targets',
        show: (r) => can('depotTargets', r),
      },
      {
        href: '/dashboard/huddle',
        labelKey: 'huddle',
        show: (r) => can('depotHuddle', r),
      },
      {
        href: '/dashboard/handover',
        labelKey: 'handover',
        show: (r) => can('depotHandover', r),
      },
      {
        href: '/dashboard/maintenance',
        labelKey: 'maintenance',
        show: (r) => can('depotMaintenance', r),
      },
      {
        href: '/dashboard/broadcast',
        labelKey: 'broadcast',
        show: canBroadcastToCouriers,
      },
      // The depot manager's HR doors. They live in the /hr console, which the HQ rail reaches
      // and this rail never did, so leave, kasbon and borrow requests were typed-URL only.
      // Each carries the capability its own screen's server calls check.
      // The Ops binary keeps only selected HR routes, so each door below is guarded
      // by the exact route it opens (build-mobile reads the literal).
      {
        href: '/hr/leave',
        labelKey: 'hrLeave',
        show: (r) => can('leaveApprove', r) && isServedHere('/hr/leave'),
      },
      {
        href: '/hr/loans',
        labelKey: 'hrLoans',
        show: (r) => can('kasbonApprove', r) && isServedHere('/hr/loans'),
      },
      {
        href: '/hr/depot-requests',
        labelKey: 'hrDepotRequests',
        show: (r) => can('employeeAssignRequest', r) && isServedHere('/hr/depot-requests'),
      },
      {
        href: '/dashboard/onboarding',
        labelKey: 'staffOnboarding',
        show: canUseManagerConsole,
      },
    ],
  },
  {
    headKey: 'settings',
    items: [
      { href: '/dashboard/settings', labelKey: 'settings', show: canManageDepots },
      { href: '/dashboard/depots', labelKey: 'depots', show: canManageDepots },
      { href: '/dashboard/payments', labelKey: 'payments', show: canManageDepots },
      { href: '/dashboard/account', labelKey: 'account', show: isStaff },
      // Shows the caller their OWN effective capabilities. Gating that on a capability would
      // be a screen you need permission to be told what you have permission for.
      { href: '/dashboard/roles', labelKey: 'roles', show: isStaff },
      { href: '/dashboard/audit', labelKey: 'audit', show: canViewAudit },
    ],
  },
  {
    headKey: 'myAttendance',
    items: [
      // Self-service absen. Lives here rather than in a console of its own because the
      // supervision ranks land on this rail and had no way at all to reach /hr/me.
      { href: '/hr/me', labelKey: 'selfService', show: canPunchAttendance },
    ],
  },
];

/** A hub as one role sees it: only the screens it may open, in tab order. */
export interface VisibleHub {
  hub: RailGroup;
  items: RailItem[];
}

/** The hubs a role sees, each with only the screens it may open; a hub with none is not shown. */
export function hubsFor(role: Role): VisibleHub[] {
  return GROUPS.map((hub) => ({ hub, items: hub.items.filter((i) => i.show(role)) })).filter(
    (h) => h.items.length > 0,
  );
}

/**
 * The hub whose screen `path` IS (normalised for the APK's final slash), as `role` sees
 * it. Only an exact member: a detail screen below one is not a hub page and gets no tabs.
 */
export function hubOf(path: string, role: Role): VisibleHub | undefined {
  const at = normalisePath(path);
  return hubsFor(role).find((h) => h.items.some((i) => i.href === at));
}
