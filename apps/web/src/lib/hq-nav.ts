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
  // Milestone-A routes render now; others are declared for easy extension but hidden.
  ready: boolean;
  /**
   * Capability the screen genuinely needs, when the HQ gate alone is not enough.
   *
   * The comment below used to say items "don't carry finer gates in Milestone A", and a
   * browser pass as a real HEAD_OFFICE proved that assumption wrong: six platform-admin
   * screens are `platformAdmin` (SUPER_ADMIN only) server-side and answered 403 while
   * sitting in the nav of every role the console admits. A menu entry that can only ever
   * fail reads as a broken system, not as a permission boundary.
   */
  cap?: Capability;
}
export interface HqRailGroup {
  // i18n key under hq.groups.*
  headKey: string;
  items: HqRailItem[];
}

// Full HQ area-map (design 11a). The layout gate admits HEAD_OFFICE, DIREKTUR and
// SUPER_ADMIN; items that need MORE than that carry `cap` and are filtered per role by
// `hqGroupsForRole`. (This comment used to say no item needed a finer gate — six of them
// did, and only a browser pass as a real head-office account found out.) Only `ready`
// items render; the rest sit here so wiring a later milestone is a one-line flag flip.
//
// The last three `ready: false` entries (/hq/flow, /hq/system, /hq/admin) are gone: no page
// was ever written for any of them, so the flag could not be flipped — they were a to-do
// list pretending to be a feature flag.
export const HQ_GROUPS: HqRailGroup[] = [
  {
    headKey: 'overview',
    items: [
      { href: '/hq', labelKey: 'overview', icon: ChartLineUp, ready: true, cap: 'dashboard' },
      { href: '/hq/search', labelKey: 'search', icon: MagnifyingGlass, ready: true, cap: 'depotDirectory' },
      { href: '/hq/access', labelKey: 'access', icon: ShieldCheck, ready: true , cap: 'accessMatrixWrite' },
    ],
  },
  {
    headKey: 'network',
    items: [
      { href: '/hq/depots', labelKey: 'depots', icon: Storefront, ready: true, cap: 'depotDirectory' },
      { href: '/hq/hierarchy', labelKey: 'hierarchy', icon: TreeStructure, ready: true, cap: 'hierarchyAdmin' },
      // The depot console, which HQ can open but had no door to: the shop nav that
      // carries its link is stripped on console routes, so from here /dashboard was
      // reachable only by typing the URL — and with it the pelanggan/stok/harga imports.
      { href: '/dashboard', labelKey: 'opsConsole', icon: Gauge, ready: true, cap: 'dashboard' },
    ],
  },
  {
    headKey: 'staff',
    items: [
      { href: '/hq/staff', labelKey: 'staff', icon: UserGear, ready: true, cap: 'staffAdmin' },
      { href: '/hr', labelKey: 'hr', icon: UsersThree, ready: true, cap: 'hrView' },
    ],
  },
  {
    headKey: 'franchise',
    items: [
      { href: '/hq/applications', labelKey: 'applications', icon: FileText, ready: true, cap: 'franchiseApplications' },
      { href: '/hq/franchise', labelKey: 'franchise', icon: Buildings, ready: true, cap: 'hqPayoutRead' },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/hq/payments', labelKey: 'payments', icon: Wallet, ready: true, cap: 'hqPayoutRead' },
      { href: '/hq/pricing', labelKey: 'pricing', icon: Tag, ready: true, cap: 'priceOverrideDecide' },
      { href: '/hq/vouchers', labelKey: 'vouchers', icon: Ticket, ready: true, cap: 'voucherRead' },
      { href: '/hq/refunds', labelKey: 'refunds', icon: Receipt, ready: true, cap: 'refundQueueRead' },
      { href: '/hq/reconciliation', labelKey: 'reconciliation', icon: Scales, ready: true, cap: 'commissionRead' },
      { href: '/hq/reports/export', labelKey: 'reportsExport', icon: Export, ready: true, cap: 'orderReports' },
      { href: '/hq/tax', labelKey: 'tax', icon: Invoice, ready: true , cap: 'taxSettings' },
    ],
  },
  {
    headKey: 'daily',
    items: [
      { href: '/hq/inventory', labelKey: 'inventory', icon: Package, ready: true, cap: 'inventoryRead' },
      { href: '/hq/returns', labelKey: 'returns', icon: Recycle, ready: true, cap: 'returnsRead' },
      { href: '/hq/roster', labelKey: 'roster', icon: Truck, ready: true , cap: 'driverRoster' },
      { href: '/hq/orders', labelKey: 'orders', icon: ClipboardText, ready: true, cap: 'orderQueue' },
      { href: '/hq/notifications', labelKey: 'notifications', icon: Bell, ready: true, cap: 'opsNotif' },
    ],
  },
  {
    headKey: 'analytics',
    items: [
      { href: '/hq/analytics', labelKey: 'analytics', icon: TrendUp, ready: true, cap: 'dashboard' },
      { href: '/hq/scorecard', labelKey: 'scorecard', icon: Trophy, ready: true, cap: 'dashboard' },
      { href: '/hq/compare', labelKey: 'compare', icon: ChartBar, ready: true, cap: 'dashboard' },
      { href: '/hq/forecast', labelKey: 'forecast', icon: ChartLineUp, ready: true, cap: 'forecast' },
      { href: '/hq/churn', labelKey: 'churn', icon: UsersThree, ready: true, cap: 'churn' },
      { href: '/hq/campaigns', labelKey: 'campaigns', icon: Megaphone, ready: true , cap: 'campaignRead' },
      { href: '/hq/promotions', labelKey: 'promotions', icon: ImageIcon, ready: true, cap: 'promotionRead' },
      { href: '/hq/customers', labelKey: 'customers', icon: UserCircle, ready: true, cap: 'customerPhoneLookup' },
      // ponytail: depot managers reach /resellers by direct URL for now — no manager-rail
      // entry yet (out of scope for this pass).
      { href: '/resellers', labelKey: 'resellers', icon: Handshake, ready: true, cap: 'resellerView' },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      { href: '/hq/catalog', labelKey: 'catalog', icon: Package, ready: true , cap: 'catalogWrite' },
      { href: '/hq/loyalty', labelKey: 'loyalty', icon: Crown, ready: true, cap: 'rewardCatalog' },
      { href: '/hq/subscriptions', labelKey: 'subscriptions', icon: ArrowsClockwise, ready: true, cap: 'hqBackOffice' },
    ],
  },
  {
    headKey: 'forms',
    items: [
      { href: '/hq/forms/pricing-rule', labelKey: 'formPricingRule', icon: SlidersHorizontal, ready: true, cap: 'depotAdmin' },
      { href: '/hq/forms/voucher', labelKey: 'formVoucher', icon: Ticket, ready: true, cap: 'voucherWrite' },
      { href: '/hq/forms/commission', labelKey: 'formCommission', icon: Percent, ready: true, cap: 'commissionRead' },
      { href: '/hq/forms/segment', labelKey: 'formSegment', icon: UsersThree, ready: true, cap: 'campaignWrite' },
      { href: '/hq/staff/import', labelKey: 'staffImport', icon: UploadSimple, ready: true, cap: 'staffAdmin' },
      { href: '/hq/broadcast', labelKey: 'broadcast', icon: Broadcast, ready: true , cap: 'campaignWrite' },
    ],
  },
  {
    headKey: 'flow',
    items: [
      { href: '/hq/incidents', labelKey: 'incidents', icon: WarningOctagon, ready: true, cap: 'hqBackOffice' },
      { href: '/hq/tickets', labelKey: 'tickets', icon: ChatCircleDots, ready: true, cap: 'hqBackOffice' },
      { href: '/hq/fraud', labelKey: 'fraud', icon: ShieldWarning, ready: true, cap: 'fraudReview' },
      { href: '/hq/scheduled-reports', labelKey: 'scheduledReports', icon: CalendarCheck, ready: true, cap: 'hqBackOffice' },
      { href: '/hq/onboarding', labelKey: 'onboarding', icon: ListChecks, ready: true , cap: 'depotDirectory' },
    ],
  },
  {
    headKey: 'system',
    items: [
      { href: '/hq/audit', labelKey: 'audit', icon: ClockCounterClockwise, ready: true, cap: 'hqBackOffice' },
      { href: '/hq/flags', labelKey: 'flags', icon: Flag, ready: true, cap: 'platformAdmin' },
      { href: '/hq/health', labelKey: 'health', icon: Heartbeat, ready: true, cap: 'hqBackOffice' },
      { href: '/hq/exports', labelKey: 'exports', icon: FileArrowDown, ready: true, cap: 'hqBackOffice' },
      { href: '/hq/api-keys', labelKey: 'apiKeys', icon: Key, ready: true, cap: 'platformAdmin' },
      { href: '/hq/webhooks', labelKey: 'webhooks', icon: Plugs, ready: true, cap: 'platformAdmin' },
      { href: '/hq/sla-policy', labelKey: 'slaPolicy', icon: Timer, ready: true , cap: 'depotAdmin' },
      { href: '/hq/forecast-models', labelKey: 'forecastModels', icon: ChartLineUp, ready: true, cap: 'forecast' },
      { href: '/hq/retention', labelKey: 'retention', icon: Archive, ready: true, cap: 'platformAdmin' },
      { href: '/hq/pdp', labelKey: 'pdp', icon: ShieldCheck, ready: true , cap: 'pdpRequests' },
      { href: '/hq/security', labelKey: 'security', icon: Lock, ready: true, cap: 'platformAdmin' },
    ],
  },
  {
    headKey: 'admin',
    items: [
      { href: '/hq/profile', labelKey: 'profile', icon: IdentificationBadge, ready: true, cap: 'ownNotifPrefs' },
      { href: '/hq/wizard', labelKey: 'wizard', icon: Sparkle, ready: true, cap: 'platformAdmin' },
      { href: '/hq/invoice-template', labelKey: 'invoiceTemplate', icon: Article, ready: true , cap: 'taxSettings' },
      { href: '/hq/content', labelKey: 'content', icon: Translate, ready: true, cap: 'platformAdmin' },
      { href: '/hq/sitemap', labelKey: 'sitemap', icon: SquaresFour, ready: true },
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
    items: g.items.filter((i) => i.ready && (!i.cap || can(i.cap, role))),
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
