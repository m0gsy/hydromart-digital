// The /hq navigation model: which screens exist, which capability each needs, and the two
// questions both the rail and the layout ask of it.
//
// Data, not a component. `lib/roles.ts` needs `hqItemsForRole` to answer "where does this
// role land", and importing a component into lib is a cycle — the rail already imports
// `can`/`isHq` from roles. Splitting the table out is what lets one table answer the rail,
// the page gate and the landing, instead of three copies drifting apart.

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  Archive,
  ArrowsClockwise,
  Article,
  Bell,
  Broadcast,
  Buildings,
  CalendarCheck,
  ChartBar,
  ChartLineUp,
  ChatCircleDots,
  ClipboardText,
  ClockCounterClockwise,
  Crown,
  Export,
  FileArrowDown,
  FileText,
  Flag,
  Gauge,
  Handshake,
  Heartbeat,
  IdentificationBadge,
  ImageIcon,
  Invoice,
  Key,
  ListChecks,
  Lock,
  MagnifyingGlass,
  Megaphone,
  Package,
  Percent,
  Plugs,
  Receipt,
  Recycle,
  Scales,
  ShieldCheck,
  ShieldWarning,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  Storefront,
  Tag,
  Ticket,
  Timer,
  Translate,
  TreeStructure,
  TrendUp,
  Trophy,
  Truck,
  UploadSimple,
  UserCircle,
  UserGear,
  UsersThree,
  Wallet,
  WarningOctagon,
} from '@phosphor-icons/react';

import { can, isHq, type Capability } from '@/lib/roles';

/** Same shape `roles.ts` uses: whatever the session says, including nothing. */
type Role = string | null | undefined;

export interface HqRailItem {
  href: string;
  // i18n key under hq.nav.*
  labelKey: string;
  icon: PhosphorIcon;
  /**
   * The capability this screen needs. REQUIRED — every one of the sixty-one carries one.
   *
   * It was optional, and the comment here used to say items "don't carry finer gates in
   * Milestone A". A browser pass as a real HEAD_OFFICE proved that wrong (six platformAdmin
   * screens sat in every role's nav and answered 403), and step 07 of the console audit
   * then found the rest: 45 of 61 doors with no gate at all, and three naming a capability
   * the server does not check.
   *
   * Making it required is the last of that: "every door has a lock" stops being a thing a
   * script reports and becomes a thing the compiler refuses to let you break.
   * `check-console-gates.mjs` still checks the harder half — that the lock is the one the
   * server actually turns.
   */
  cap: Capability;
}
export interface HqRailGroup {
  // i18n key under hq.groups.*
  headKey: string;
  items: HqRailItem[];
}

// Full HQ area-map (design 11a). Every item carries the capability its own page needs, and
// `hqGroupsForRole` filters on it; `capForHqPath` hands the same value to the layout, so a
// hidden link and a refused page are one decision rather than two.
//
// There used to be a `ready` flag as well, for "declared but not built yet". The last three
// entries it hid (/hq/flow, /hq/system, /hq/admin) were deleted when it turned out no page
// had ever been written for them — a to-do list pretending to be a feature flag. What was
// left was 61 of 61 items marked ready, which is a field with one value and a branch no
// test could ever take.
export const HQ_GROUPS: HqRailGroup[] = [
  {
    headKey: 'overview',
    items: [
      { href: '/hq', labelKey: 'overview', icon: ChartLineUp, cap: 'dashboard' },
      { href: '/hq/search', labelKey: 'search', icon: MagnifyingGlass, cap: 'depotDirectory' },
      { href: '/hq/access', labelKey: 'access', icon: ShieldCheck , cap: 'accessMatrixWrite' },
    ],
  },
  {
    headKey: 'network',
    items: [
      { href: '/hq/depots', labelKey: 'depots', icon: Storefront, cap: 'depotDirectory' },
      { href: '/hq/hierarchy', labelKey: 'hierarchy', icon: TreeStructure, cap: 'hierarchyAdmin' },
      // The depot console, which HQ can open but had no door to: the shop nav that
      // carries its link is stripped on console routes, so from here /dashboard was
      // reachable only by typing the URL — and with it the pelanggan/stok/harga imports.
      { href: '/dashboard', labelKey: 'opsConsole', icon: Gauge, cap: 'dashboard' },
    ],
  },
  {
    headKey: 'staff',
    items: [
      { href: '/hq/staff', labelKey: 'staff', icon: UserGear, cap: 'staffAdmin' },
      { href: '/hr', labelKey: 'hr', icon: UsersThree, cap: 'hrView' },
    ],
  },
  {
    headKey: 'franchise',
    items: [
      { href: '/hq/applications', labelKey: 'applications', icon: FileText, cap: 'franchiseApplications' },
      { href: '/hq/franchise', labelKey: 'franchise', icon: Buildings, cap: 'hqPayoutRead' },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/hq/payments', labelKey: 'payments', icon: Wallet, cap: 'hqPayoutRead' },
      { href: '/hq/pricing', labelKey: 'pricing', icon: Tag, cap: 'priceOverrideDecide' },
      { href: '/hq/vouchers', labelKey: 'vouchers', icon: Ticket, cap: 'voucherRead' },
      { href: '/hq/refunds', labelKey: 'refunds', icon: Receipt, cap: 'refundQueueRead' },
      { href: '/hq/reconciliation', labelKey: 'reconciliation', icon: Scales, cap: 'commissionRead' },
      { href: '/hq/reports/export', labelKey: 'reportsExport', icon: Export, cap: 'orderReports' },
      { href: '/hq/tax', labelKey: 'tax', icon: Invoice , cap: 'taxSettings' },
    ],
  },
  {
    headKey: 'daily',
    items: [
      { href: '/hq/inventory', labelKey: 'inventory', icon: Package, cap: 'inventoryRead' },
      { href: '/hq/returns', labelKey: 'returns', icon: Recycle, cap: 'returnsRead' },
      { href: '/hq/roster', labelKey: 'roster', icon: Truck , cap: 'driverRoster' },
      { href: '/hq/orders', labelKey: 'orders', icon: ClipboardText, cap: 'orderQueue' },
      { href: '/hq/notifications', labelKey: 'notifications', icon: Bell, cap: 'opsNotif' },
    ],
  },
  {
    headKey: 'analytics',
    items: [
      { href: '/hq/analytics', labelKey: 'analytics', icon: TrendUp, cap: 'dashboard' },
      { href: '/hq/scorecard', labelKey: 'scorecard', icon: Trophy, cap: 'dashboard' },
      { href: '/hq/compare', labelKey: 'compare', icon: ChartBar, cap: 'dashboard' },
      { href: '/hq/forecast', labelKey: 'forecast', icon: ChartLineUp, cap: 'forecast' },
      { href: '/hq/churn', labelKey: 'churn', icon: UsersThree, cap: 'churn' },
      { href: '/hq/campaigns', labelKey: 'campaigns', icon: Megaphone , cap: 'campaignRead' },
      { href: '/hq/promotions', labelKey: 'promotions', icon: ImageIcon, cap: 'promotionRead' },
      { href: '/hq/customers', labelKey: 'customers', icon: UserCircle, cap: 'customerPhoneLookup' },
      // ponytail: depot managers reach /resellers by direct URL for now — no manager-rail
      // entry yet (out of scope for this pass).
      { href: '/resellers', labelKey: 'resellers', icon: Handshake, cap: 'resellerView' },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      { href: '/hq/catalog', labelKey: 'catalog', icon: Package , cap: 'catalogWrite' },
      { href: '/hq/loyalty', labelKey: 'loyalty', icon: Crown, cap: 'rewardCatalog' },
      { href: '/hq/subscriptions', labelKey: 'subscriptions', icon: ArrowsClockwise, cap: 'hqBackOffice' },
    ],
  },
  {
    headKey: 'forms',
    items: [
      { href: '/hq/forms/pricing-rule', labelKey: 'formPricingRule', icon: SlidersHorizontal, cap: 'depotAdmin' },
      { href: '/hq/forms/voucher', labelKey: 'formVoucher', icon: Ticket, cap: 'voucherWrite' },
      { href: '/hq/forms/commission', labelKey: 'formCommission', icon: Percent, cap: 'commissionRead' },
      { href: '/hq/forms/segment', labelKey: 'formSegment', icon: UsersThree, cap: 'campaignWrite' },
      { href: '/hq/staff/import', labelKey: 'staffImport', icon: UploadSimple, cap: 'staffAdmin' },
      { href: '/hq/broadcast', labelKey: 'broadcast', icon: Broadcast , cap: 'campaignWrite' },
    ],
  },
  {
    headKey: 'flow',
    items: [
      { href: '/hq/incidents', labelKey: 'incidents', icon: WarningOctagon, cap: 'hqBackOffice' },
      { href: '/hq/tickets', labelKey: 'tickets', icon: ChatCircleDots, cap: 'hqBackOffice' },
      { href: '/hq/fraud', labelKey: 'fraud', icon: ShieldWarning, cap: 'fraudReview' },
      { href: '/hq/scheduled-reports', labelKey: 'scheduledReports', icon: CalendarCheck, cap: 'hqBackOffice' },
      { href: '/hq/onboarding', labelKey: 'onboarding', icon: ListChecks , cap: 'depotDirectory' },
    ],
  },
  {
    headKey: 'system',
    items: [
      { href: '/hq/audit', labelKey: 'audit', icon: ClockCounterClockwise, cap: 'hqBackOffice' },
      { href: '/hq/flags', labelKey: 'flags', icon: Flag, cap: 'platformAdmin' },
      { href: '/hq/health', labelKey: 'health', icon: Heartbeat, cap: 'hqBackOffice' },
      { href: '/hq/exports', labelKey: 'exports', icon: FileArrowDown, cap: 'hqBackOffice' },
      { href: '/hq/api-keys', labelKey: 'apiKeys', icon: Key, cap: 'platformAdmin' },
      { href: '/hq/webhooks', labelKey: 'webhooks', icon: Plugs, cap: 'platformAdmin' },
      { href: '/hq/sla-policy', labelKey: 'slaPolicy', icon: Timer , cap: 'depotAdmin' },
      { href: '/hq/forecast-models', labelKey: 'forecastModels', icon: ChartLineUp, cap: 'forecast' },
      { href: '/hq/retention', labelKey: 'retention', icon: Archive, cap: 'platformAdmin' },
      { href: '/hq/pdp', labelKey: 'pdp', icon: ShieldCheck , cap: 'pdpRequests' },
      { href: '/hq/security', labelKey: 'security', icon: Lock, cap: 'platformAdmin' },
    ],
  },
  {
    headKey: 'admin',
    items: [
      { href: '/hq/profile', labelKey: 'profile', icon: IdentificationBadge, cap: 'ownNotifPrefs' },
      { href: '/hq/wizard', labelKey: 'wizard', icon: Sparkle, cap: 'platformAdmin' },
      { href: '/hq/invoice-template', labelKey: 'invoiceTemplate', icon: Article , cap: 'taxSettings' },
      { href: '/hq/content', labelKey: 'content', icon: Translate, cap: 'platformAdmin' },
      // The screen index. It renders `hqGroupsForRole` — it shows a role only what that
      // role can already reach — so the door it needs is the console door itself.
      { href: '/hq/sitemap', labelKey: 'sitemap', icon: SquaresFour, cap: 'hqConsole' },
    ],
  },
];

/**
 * The nav model as THIS role may see it — groups that end up empty drop out.
 *
 * One helper for every surface derived from `HQ_GROUPS` (the rail, the screen index, the
 * command palette, the access landing). Four copies of the filter would drift, and a
 * screen index still listing a door the rail has hidden is the same lie wearing a hat.
 */
export function hqGroupsForRole(role: Role): HqRailGroup[] {
  if (!isHq(role)) return [];
  return HQ_GROUPS.map((g) => ({
    ...g,
    // `cap` filters on top of the console gate: an item whose capability this role lacks is
    // not shown at all, rather than shown and then refused by the server.
    items: g.items.filter((i) => can(i.cap, role)),
  })).filter((g) => g.items.length > 0);
}

export function hqItemsForRole(role: Role): HqRailItem[] {
  return hqGroupsForRole(role).flatMap((g) => g.items);
}

/**
 * The capability a /hq path needs, or null when the console gate is the whole of it.
 *
 * CA-2-60: 58 of the 64 /hq pages gated nothing of their own. The rail hid what a role
 * could not use, and typing the URL walked straight past that — onto a screen that then
 * fetched, got 403s, and rendered as an error or, worse, as empty. Hiding a link is not
 * an access rule; it is a courtesy on top of one.
 *
 * Rather than 61 copies of the same three lines, the layout asks this. The answer comes
 * from the SAME table the rail filters on, so the two can never disagree: a capability
 * added to an item gates its page in the same commit.
 *
 * Longest prefix wins, so `/hq/depots/detail` inherits `/hq/depots` and a child that
 * needs MORE than its parent can say so by carrying its own row.
 */
export function capForHqPath(pathname: string | null | undefined): Capability | null {
  if (!pathname) return null;
  let best: { href: string; cap?: Capability } | null = null;
  for (const group of HQ_GROUPS) {
    for (const item of group.items) {
      if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) continue;
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.cap ?? null;
}
