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
  canUseOperatorConsole,
  isDepotOperator,
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
  // i18n key under ops.groups.* — resolved at render via t(). The hub's name (PR-3b).
  headKey: string;
  /** The hub's row icon in the rail and the phone sheet. */
  icon: Icon;
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
    icon: ChartLineUp,
    items: [
      // PR-3b: the head of depot's /dashboard is their operator home, so it is a screen of this
      // hub for them too (the operator bar's Ringkasan stands for it). Narrower than the page
      // (dashboardLandingView), which also answers a franchise owner: their row stays Waralabaku.
      {
        href: '/dashboard',
        labelKey: 'operations',
        icon: ChartLineUp,
        show: (role) => canViewDashboard(role) || isDepotOperator(role),
      },
      {
        href: '/dashboard/franchise',
        labelKey: 'myFranchise',
        icon: Buildings,
        show: canViewFranchise,
      },
      { href: '/dashboard/insight', labelKey: 'insight', icon: SquaresFour, show: canViewInsight },
      {
        href: '/dashboard/search',
        labelKey: 'search',
        icon: MagnifyingGlass,
        show: (role) => can('depotDirectory', role),
      },
      { href: '/dashboard/forecast', labelKey: 'forecast', icon: TrendUp, show: canViewForecast },
      {
        href: '/dashboard/notifications',
        labelKey: 'notifications',
        icon: Bell,
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
        icon: Buildings,
        // PR-3b: the overview is a `dashboard` screen (`capForHqPath`); a console role without
        // it (FINANCE) was offered a door to the one HQ page that refuses it. It gets the
        // next one instead, the first HQ screen it may open, as `consoleHome` lands it.
        show: (role) => isHq(role) && can('dashboard', role) && isServedHere('/hq'),
      },
      {
        href: '/hq/search',
        labelKey: 'hqConsole',
        icon: Buildings,
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
        icon: Buildings,
        // The Ops binary prunes /hq; the guard names the exact route the link goes to.
        show: (role) =>
          !isHq(role) && hasPartialHqDoor(role as never) && isServedHere('/hq/campaigns'),
      },
    ],
  },
  {
    headKey: 'orders',
    icon: ClipboardText,
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
        href: '/dashboard/disputes',
        labelKey: 'disputes',
        icon: Scales,
        show: (r) => can('depotDisputes', r),
      },
      {
        href: '/dashboard/subscriptions',
        labelKey: 'subscriptions',
        icon: ArrowsClockwise,
        show: (r) => can('depotSubscriptions', r),
      },
    ],
  },
  {
    headKey: 'counter',
    icon: Storefront,
    items: [
      {
        href: '/dashboard/walk-in',
        labelKey: 'walkIn',
        icon: Storefront,
        show: canRecordWalkInSale,
      },
    ],
  },
  {
    headKey: 'tracking',
    icon: MapPin,
    items: [
      { href: '/dashboard/tracking', labelKey: 'tracking', icon: MapPin, show: canViewTracking },
    ],
  },
  {
    headKey: 'stock',
    icon: Package,
    items: [
      {
        href: '/dashboard/inventory',
        labelKey: 'inventory',
        icon: Package,
        show: canViewInventory,
      },
      { href: '/dashboard/returns', labelKey: 'returns', icon: Recycle, show: canViewReturns },
      { href: '/dashboard/wastage', labelKey: 'wastage', icon: Trash, show: canUseManagerConsole },
      { href: '/dashboard/meter', labelKey: 'meter', icon: Gauge, show: canViewMeterReading },
    ],
  },
  {
    headKey: 'purchasing',
    icon: Factory,
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
    headKey: 'cash',
    icon: Wallet,
    items: [
      {
        href: '/dashboard/settlements',
        labelKey: 'settlements',
        icon: HandCoins,
        show: canVerifySettlement,
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
    ],
  },
  {
    headKey: 'approvals',
    icon: ListChecks,
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
    ],
  },
  {
    headKey: 'customers',
    icon: UsersThree,
    items: [
      {
        href: '/dashboard/customers',
        labelKey: 'customers',
        icon: UsersThree,
        show: canViewDepotCrm,
      },
      { href: '/dashboard/crm', labelKey: 'crm', icon: ChartPieSlice, show: canViewDepotCrm },
      { href: '/dashboard/ratings', labelKey: 'ratings', icon: Star, show: canUseManagerConsole },
      {
        href: '/dashboard/recommendations',
        labelKey: 'recommendations',
        icon: Sparkle,
        show: canManageDepots,
      },
    ],
  },
  {
    headKey: 'loyalty',
    icon: Gift,
    items: [
      { href: '/dashboard/loyalty', labelKey: 'loyalty', icon: Medal, show: canUseManagerConsole },
      {
        href: '/dashboard/redemptions',
        labelKey: 'redemptions',
        icon: Gift,
        show: canHandOverRewards,
      },
      { href: '/dashboard/referral', labelKey: 'referral', icon: Gift, show: canUseManagerConsole },
    ],
  },
  {
    headKey: 'marketing',
    icon: Megaphone,
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
      { href: '/dashboard/vouchers', labelKey: 'vouchers', icon: Ticket, show: canViewVouchers },
      {
        href: '/dashboard/campaigns',
        labelKey: 'campaign',
        icon: ChatCircleText,
        show: canViewCampaigns,
      },
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
    headKey: 'catalog',
    icon: Tag,
    items: [
      {
        href: '/dashboard/products/manage',
        labelKey: 'manageProducts',
        icon: Cube,
        show: canManageDepots,
      },
      { href: '/dashboard/pricing', labelKey: 'pricing', icon: Tag, show: canManagePricing },
      { href: '/dashboard/wholesale', labelKey: 'wholesale', icon: Stack, show: canManagePricing },
    ],
  },
  {
    headKey: 'commission',
    icon: HandCoins,
    items: [
      {
        href: '/dashboard/commission',
        labelKey: 'commission',
        icon: HandCoins,
        show: canViewCourierCommission,
      },
      {
        href: '/dashboard/earning-rules',
        labelKey: 'earningRules',
        icon: Coins,
        show: canManageEarningRules,
      },
    ],
  },
  {
    headKey: 'finance',
    icon: ChartPieSlice,
    items: [
      { href: '/dashboard/payout', labelKey: 'payout', icon: Wallet, show: canViewPayout },
      {
        href: '/dashboard/expense-claims',
        labelKey: 'expenseClaims',
        icon: Receipt,
        show: canApproveExpense,
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
      // Built, gated and unreachable: nothing in any nav pointed at these two, so the only
      // way in was to type the URL. `canViewDashboard` is the gate each page enforces.
      {
        href: '/dashboard/monthly-pnl',
        labelKey: 'monthlyPnl',
        icon: ChartPieSlice,
        show: canViewDashboard,
      },
      { href: '/dashboard/compare', labelKey: 'compare', icon: Scales, show: canUseManagerConsole },
    ],
  },
  {
    headKey: 'team',
    icon: Handshake,
    items: [
      { href: '/dashboard/staff', labelKey: 'staff', icon: UserGear, show: canManageStaff },
      {
        href: '/dashboard/franchise/attendance',
        labelKey: 'ownerAttendance',
        icon: UsersThree,
        show: canViewOwnAttendance,
      },
      {
        href: '/dashboard/team-performance',
        labelKey: 'teamPerformance',
        icon: UsersThree,
        show: canViewTeamPerformance,
      },
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
      {
        href: '/dashboard/broadcast',
        labelKey: 'broadcast',
        icon: Megaphone,
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
    headKey: 'settings',
    icon: GearSix,
    items: [
      { href: '/dashboard/settings', labelKey: 'settings', icon: GearSix, show: canManageDepots },
      { href: '/dashboard/depots', labelKey: 'depots', icon: Storefront, show: canManageDepots },
      // Also unreachable before: the depot config screen and the staff account screen.
      {
        href: '/dashboard/depot-settings',
        labelKey: 'depotSettings',
        icon: GearSix,
        show: canManageDepots,
      },
      { href: '/dashboard/payments', labelKey: 'payments', icon: QrCode, show: canManageDepots },
      {
        href: '/dashboard/profile',
        labelKey: 'profile',
        icon: UserGear,
        show: canUseManagerConsole,
      },
      // Flow PR-3b: the operator console's own settings screen, a row of the table like every
      // other tab it shows (its page gate is canUseOperatorConsole). 3d folds it into account.
      {
        href: '/dashboard/operator-settings',
        labelKey: 'operatorSettings',
        icon: GearSix,
        show: canUseOperatorConsole,
      },
      { href: '/dashboard/account', labelKey: 'account', icon: UserGear, show: isStaff },
      // Shows the caller their OWN effective capabilities. Gating that on a capability would
      // be a screen you need permission to be told what you have permission for.
      { href: '/dashboard/roles', labelKey: 'roles', icon: ShieldCheck, show: isStaff },
      { href: '/dashboard/audit', labelKey: 'audit', icon: Scroll, show: canViewAudit },
    ],
  },
  {
    headKey: 'myAttendance',
    icon: CalendarCheck,
    items: [
      // Self-service absen. Lives here rather than in a console of its own because the
      // supervision ranks land on this rail and had no way at all to reach /hr/me.
      { href: '/hr/me', labelKey: 'selfService', icon: CalendarCheck, show: canPunchAttendance },
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
 * The hub whose screen `path` IS (normalised, so the APK's `/x/` is `/x`), as `role` sees
 * it. Only an exact member: a detail screen below one is not a hub page and gets no tabs.
 */
export function hubOf(path: string, role: Role): VisibleHub | undefined {
  const at = normalisePath(path);
  return hubsFor(role).find((h) => h.items.some((i) => i.href === at));
}
