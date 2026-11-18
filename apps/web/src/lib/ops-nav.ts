// The depot-console navigation model: every screen the ops rail offers, the gate its row
// needs, grouped by job-to-be-done.
//
// Data, not a component (the `lib/hq-nav.ts` pattern). The desktop rail, the phone "Lainnya"
// sheet and `canOpenRoute` all read this one table; flow PR-3a moved it here from
// `components/dashboard/ops-rail.tsx` unchanged, so a lib module no longer imports a component.

import {
  ArrowsClockwise,
  Bell,
  Buildings,
  CalendarCheck,
  ChartLineUp,
  ChartPieSlice,
  ChatCircleText,
  ClipboardText,
  Coins,
  Cube,
  FirstAid,
  Gavel,
  Gift,
  HandCoins,
  ListChecks,
  Medal,
  Notebook,
  Receipt,
  Factory,
  GearSix,
  MagnifyingGlass,
  MapPin,
  Handshake,
  Megaphone,
  Package,
  QrCode,
  Recycle,
  Scales,
  Scroll,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Stack,
  Star,
  Storefront,
  Target,
  Gauge,
  Trash,
  Truck,
  UserGear,
  Tag,
  Ticket,
  TrendUp,
  UsersThree,
  Wallet,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import { isServedHere } from '@/lib/deep-link';
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
  canViewMeterReading,
  can,
  isHq,
  isStaff,
  canViewResellers,
  canViewPromotions,
} from '@/lib/roles';
import { canViewInsight } from '@/lib/insight/access';

type Role = string | null | undefined;

export interface RailItem {
  href: string;
  // i18n key under ops.nav.* — resolved at render via t().
  labelKey: string;
  icon: Icon;
  show: (role: Role) => boolean;
}
export interface RailGroup {
  // i18n key under ops.groups.* — resolved at render via t().
  headKey: string;
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
      {
        href: '/dashboard/franchise',
        labelKey: 'myFranchise',
        icon: Buildings,
        show: canViewFranchise,
      },
      {
        href: '/dashboard/franchise/attendance',
        labelKey: 'ownerAttendance',
        icon: UsersThree,
        show: canViewOwnAttendance,
      },
      { href: '/dashboard', labelKey: 'operations', icon: ChartLineUp, show: canViewDashboard },
      { href: '/dashboard/insight', labelKey: 'insight', icon: SquaresFour, show: canViewInsight },
      {
        href: '/dashboard/search',
        labelKey: 'search',
        icon: MagnifyingGlass,
        show: (role) => can('depotDirectory', role),
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
        icon: Buildings,
        show: (role) => isHq(role) && isServedHere('/hq'),
      },
      // MARKETING holds a partial door: a handful of /hq screens with no depot twin. The
      // overview is not among them, so this goes straight to the first one.
      {
        href: '/hq/campaigns',
        labelKey: 'hqConsole',
        icon: Buildings,
        // The Ops binary prunes /hq; the guard names the exact route the link goes to.
        show: (role) =>
          !isHq(role) && hasPartialHqDoor(role as never) && isServedHere('/hq/campaigns'),
      },
    ],
  },
  {
    headKey: 'daily',
    items: [
      // The page's own gate (`orders:511`), not `orderQueue`: FINANCE reads the queue to refund
      // and reconcile, and its rail had no door to it.
      {
        href: '/dashboard/orders',
        labelKey: 'orders',
        icon: ClipboardText,
        show: (role) => can('orderManageRead', role),
      },
      {
        href: '/dashboard/walk-in',
        labelKey: 'walkIn',
        icon: Storefront,
        show: canRecordWalkInSale,
      },
      { href: '/dashboard/tracking', labelKey: 'tracking', icon: MapPin, show: canViewTracking },
      {
        href: '/dashboard/inventory',
        labelKey: 'inventory',
        icon: Package,
        show: canViewInventory,
      },
      { href: '/dashboard/returns', labelKey: 'returns', icon: Recycle, show: canViewReturns },
      { href: '/dashboard/wastage', labelKey: 'wastage', icon: Trash, show: canUseManagerConsole },
      { href: '/dashboard/meter', labelKey: 'meter', icon: Gauge, show: canViewMeterReading },
      {
        href: '/dashboard/notifications',
        labelKey: 'notifications',
        icon: Bell,
        show: canViewOpsNotifications,
      },
      {
        href: '/dashboard/settlements',
        labelKey: 'settlements',
        icon: HandCoins,
        show: canVerifySettlement,
      },
      { href: '/dashboard/forecast', labelKey: 'forecast', icon: TrendUp, show: canViewForecast },
    ],
  },
  {
    headKey: 'network',
    items: [
      { href: '/dashboard/depots', labelKey: 'depots', icon: Storefront, show: canManageDepots },
      { href: '/dashboard/pricing', labelKey: 'pricing', icon: Tag, show: canManagePricing },
      { href: '/dashboard/staff', labelKey: 'staff', icon: UserGear, show: canManageStaff },
      { href: '/dashboard/settings', labelKey: 'settings', icon: GearSix, show: canManageDepots },
    ],
  },
  {
    headKey: 'marketing',
    items: [
      // Banners have their own capability (and are head office's since 2026-11-17), not CRM's.
      {
        href: '/dashboard/promotions',
        labelKey: 'promo',
        icon: Megaphone,
        show: canViewPromotions,
      },
      {
        href: '/dashboard/promo-rules',
        labelKey: 'promoRules',
        icon: Tag,
        show: canManagePromoRules,
      },
      {
        href: '/dashboard/campaigns',
        labelKey: 'campaign',
        icon: ChatCircleText,
        show: canViewCampaigns,
      },
      { href: '/dashboard/vouchers', labelKey: 'vouchers', icon: Ticket, show: canViewVouchers },
      { href: '/dashboard/churn', labelKey: 'churn', icon: UsersThree, show: canViewChurn },
      /*
       * J10: the agen registry had no door for the role that owns it. `/resellers` was
       * linked from the HQ rail only — a rail a depot manager never sees — while the
       * capability that opens the screen (`resellerView`) is theirs. Reachable by typing
       * the URL is the same as not existing.
       */
      { href: '/resellers', labelKey: 'resellers', icon: Handshake, show: canViewResellers },
    ],
  },
  {
    headKey: 'approvals',
    items: [
      {
        href: '/dashboard/approvals',
        labelKey: 'approvalsQueue',
        icon: Gavel,
        show: canReviewApprovals,
      },
      {
        href: '/dashboard/incidents',
        labelKey: 'incidents',
        icon: FirstAid,
        show: canViewIncidents,
      },
      {
        href: '/dashboard/disputes',
        labelKey: 'disputes',
        icon: Scales,
        show: (r) => can('depotDisputes', r),
      },
    ],
  },
  {
    headKey: 'procurement',
    items: [
      {
        href: '/dashboard/purchase-orders',
        labelKey: 'purchaseOrders',
        icon: Truck,
        show: canManageProcurement,
      },
      {
        href: '/dashboard/suppliers',
        labelKey: 'suppliers',
        icon: Factory,
        show: canManageProcurement,
      },
    ],
  },
  {
    headKey: 'people',
    items: [
      // Self-service absen. Lives here rather than in a console of its own because the
      // supervision ranks land on this rail and had no way at all to reach /hr/me.
      { href: '/hr/me', labelKey: 'selfService', icon: CalendarCheck, show: canPunchAttendance },
      // The roster read (`GET /rosters`) is guarded by `driverRoster` on the server, so the door
      // follows it: with `isStaff` here Supervisor, Finance, Marketing and the Franchise Owner got a
      // menu entry that opened a screen of "You do not have permission" (found in the user-guide run).
      // `isStaff` still gates the two items below.
      {
        href: '/dashboard/shift',
        labelKey: 'shift',
        icon: CalendarCheck,
        show: (r) => can('driverRoster', r),
      },
      {
        href: '/dashboard/targets',
        labelKey: 'targets',
        icon: Target,
        show: (r) => can('depotTargets', r),
      },
      {
        href: '/dashboard/huddle',
        labelKey: 'huddle',
        icon: UsersThree,
        show: (r) => can('depotHuddle', r),
      },
      {
        href: '/dashboard/handover',
        labelKey: 'handover',
        icon: ClipboardText,
        show: (r) => can('depotHandover', r),
      },
      {
        href: '/dashboard/maintenance',
        labelKey: 'maintenance',
        icon: Wrench,
        show: (r) => can('depotMaintenance', r),
      },
      // The depot manager's HR doors. They live in the /hr console, which the HQ rail reaches
      // and this rail never did, so leave, kasbon and borrow requests were typed-URL only.
      // Each carries the capability its own screen's server calls check.
      // The Ops binary keeps only selected HR routes, so each door below is guarded
      // by the exact route it opens (build-mobile reads the literal).
      {
        href: '/hr/leave',
        labelKey: 'hrLeave',
        icon: CalendarCheck,
        show: (r) => can('leaveApprove', r) && isServedHere('/hr/leave'),
      },
      {
        href: '/hr/loans',
        labelKey: 'hrLoans',
        icon: HandCoins,
        show: (r) => can('kasbonApprove', r) && isServedHere('/hr/loans'),
      },
      {
        href: '/hr/depot-requests',
        labelKey: 'hrDepotRequests',
        icon: UsersThree,
        show: (r) => can('employeeAssignRequest', r) && isServedHere('/hr/depot-requests'),
      },
      {
        href: '/dashboard/onboarding',
        labelKey: 'staffOnboarding',
        icon: ListChecks,
        show: canUseManagerConsole,
      },
    ],
  },
  {
    headKey: 'customers',
    items: [
      {
        href: '/dashboard/customers',
        labelKey: 'customers',
        icon: UsersThree,
        show: canViewDepotCrm,
      },
      { href: '/dashboard/crm', labelKey: 'crm', icon: ChartPieSlice, show: canViewDepotCrm },
      {
        href: '/dashboard/broadcast',
        labelKey: 'broadcast',
        icon: Megaphone,
        show: canBroadcastToCouriers,
      },
      { href: '/dashboard/loyalty', labelKey: 'loyalty', icon: Medal, show: canUseManagerConsole },
      {
        href: '/dashboard/redemptions',
        labelKey: 'redemptions',
        icon: Gift,
        show: canHandOverRewards,
      },
      { href: '/dashboard/referral', labelKey: 'referral', icon: Gift, show: canUseManagerConsole },
      {
        href: '/dashboard/recommendations',
        labelKey: 'recommendations',
        icon: Sparkle,
        show: canManageDepots,
      },
      { href: '/dashboard/ratings', labelKey: 'ratings', icon: Star, show: canUseManagerConsole },
      {
        href: '/dashboard/subscriptions',
        labelKey: 'subscriptions',
        icon: ArrowsClockwise,
        show: (r) => can('depotSubscriptions', r),
      },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      {
        href: '/dashboard/products/manage',
        labelKey: 'manageProducts',
        icon: Cube,
        show: canManageDepots,
      },
      { href: '/dashboard/wholesale', labelKey: 'wholesale', icon: Stack, show: canManagePricing },
      { href: '/dashboard/payments', labelKey: 'payments', icon: QrCode, show: canManageDepots },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/dashboard/payout', labelKey: 'payout', icon: Wallet, show: canViewPayout },
      {
        href: '/dashboard/expense-claims',
        labelKey: 'expenseClaims',
        icon: Receipt,
        show: canApproveExpense,
      },
      {
        href: '/dashboard/earning-rules',
        labelKey: 'earningRules',
        icon: Coins,
        show: canManageEarningRules,
      },
      {
        href: '/dashboard/cashbook',
        labelKey: 'cashbook',
        icon: Notebook,
        show: canViewDepotFinance,
      },
      {
        href: '/dashboard/payment-recon',
        labelKey: 'paymentRecon',
        icon: Scales,
        show: canViewDepotFinance,
      },
      {
        href: '/dashboard/commission',
        labelKey: 'commission',
        icon: HandCoins,
        show: canViewCourierCommission,
      },
      {
        href: '/dashboard/reports',
        labelKey: 'reports',
        icon: ChartPieSlice,
        show: (role) => can('orderReportsDepot', role),
      },
      {
        href: '/dashboard/monthly-review',
        labelKey: 'monthlyReview',
        icon: ClipboardText,
        show: canViewMonthlyClose,
      },
      { href: '/dashboard/compare', labelKey: 'compare', icon: Scales, show: canUseManagerConsole },
      // Built, gated and unreachable: nothing in any nav pointed at these two, so the only
      // way in was to type the URL. `canViewDashboard` is the gate each page enforces.
      {
        href: '/dashboard/monthly-pnl',
        labelKey: 'monthlyPnl',
        icon: ChartPieSlice,
        show: canViewDashboard,
      },
      {
        href: '/dashboard/team-performance',
        labelKey: 'teamPerformance',
        icon: UsersThree,
        show: canViewTeamPerformance,
      },
    ],
  },
  {
    headKey: 'reference',
    items: [
      // Shows the caller their OWN effective capabilities. Gating that on a capability would
      // be a screen you need permission to be told what you have permission for.
      { href: '/dashboard/roles', labelKey: 'roles', icon: ShieldCheck, show: isStaff },
      { href: '/dashboard/audit', labelKey: 'audit', icon: Scroll, show: canViewAudit },
      {
        href: '/dashboard/profile',
        labelKey: 'profile',
        icon: UserGear,
        show: canUseManagerConsole,
      },
      // Also unreachable before: the depot config screen and the staff account screen.
      {
        href: '/dashboard/depot-settings',
        labelKey: 'depotSettings',
        icon: GearSix,
        show: canManageDepots,
      },
      { href: '/dashboard/account', labelKey: 'account', icon: UserGear, show: isStaff },
    ],
  },
];
