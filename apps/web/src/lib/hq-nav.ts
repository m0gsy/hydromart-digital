// The /hq navigation model: which screens exist, which capability each needs, and the two
// questions both the rail and the layout ask of it.
//
// Data, not a component. `lib/roles.ts` needs `hqItemsForRole` to answer "where does this
// role land", and importing a component into lib is a cycle — the rail already imports
// `can`/`isHq` from roles. Splitting the table out is what lets one table answer the rail,
// the page gate and the landing, instead of three copies drifting apart.


import { can, isHq, type Capability } from '@/lib/roles';

/** Same shape `roles.ts` uses: whatever the session says, including nothing. */
type Role = string | null | undefined;

export interface HqRailItem {
  href: string;
  // i18n key under hq.nav.*
  labelKey: string;
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
      { href: '/hq', labelKey: 'overview', cap: 'dashboard' },
      { href: '/hq/search', labelKey: 'search', cap: 'depotDirectory' },
      { href: '/hq/access', labelKey: 'access', cap: 'accessMatrixWrite' },
    ],
  },
  {
    headKey: 'network',
    items: [
      { href: '/hq/depots', labelKey: 'depots', cap: 'depotDirectory' },
      { href: '/hq/hierarchy', labelKey: 'hierarchy', cap: 'hierarchyAdmin' },
      // The depot console, which HQ can open but had no door to: the shop nav that
      // carries its link is stripped on console routes, so from here /dashboard was
      // reachable only by typing the URL — and with it the pelanggan/stok/harga imports.
      { href: '/dashboard', labelKey: 'opsConsole', cap: 'dashboard' },
    ],
  },
  {
    headKey: 'staff',
    items: [
      { href: '/hq/staff', labelKey: 'staff', cap: 'staffAdmin' },
      { href: '/hr', labelKey: 'hr', cap: 'hrView' },
    ],
  },
  {
    headKey: 'franchise',
    items: [
      { href: '/hq/applications', labelKey: 'applications', cap: 'franchiseApplications' },
      { href: '/hq/franchise', labelKey: 'franchise', cap: 'hqPayoutRead' },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/hq/payments', labelKey: 'payments', cap: 'hqPayoutRead' },
      { href: '/hq/pricing', labelKey: 'pricing', cap: 'priceOverrideDecide' },
      { href: '/hq/vouchers', labelKey: 'vouchers', cap: 'voucherRead' },
      { href: '/hq/refunds', labelKey: 'refunds', cap: 'refundQueueRead' },
      { href: '/hq/reconciliation', labelKey: 'reconciliation', cap: 'commissionRead' },
      { href: '/hq/reports/export', labelKey: 'reportsExport', cap: 'orderReports' },
      { href: '/hq/tax', labelKey: 'tax', cap: 'taxSettings' },
    ],
  },
  {
    headKey: 'daily',
    items: [
      { href: '/hq/inventory', labelKey: 'inventory', cap: 'inventoryRead' },
      { href: '/hq/returns', labelKey: 'returns', cap: 'returnsRead' },
      { href: '/hq/roster', labelKey: 'roster', cap: 'driverRoster' },
      { href: '/hq/orders', labelKey: 'orders', cap: 'orderQueue' },
      { href: '/hq/notifications', labelKey: 'notifications', cap: 'opsNotif' },
    ],
  },
  {
    headKey: 'analytics',
    items: [
      { href: '/hq/analytics', labelKey: 'analytics', cap: 'dashboard' },
      { href: '/hq/scorecard', labelKey: 'scorecard', cap: 'dashboard' },
      { href: '/hq/compare', labelKey: 'compare', cap: 'dashboard' },
      { href: '/hq/forecast', labelKey: 'forecast', cap: 'forecast' },
      { href: '/hq/churn', labelKey: 'churn', cap: 'churn' },
      { href: '/hq/campaigns', labelKey: 'campaigns', cap: 'campaignRead' },
      { href: '/hq/promotions', labelKey: 'promotions', cap: 'promotionRead' },
      { href: '/hq/customers', labelKey: 'customers', cap: 'customerPhoneLookup' },
      // ponytail: depot managers reach /resellers by direct URL for now — no manager-rail
      // entry yet (out of scope for this pass).
      { href: '/resellers', labelKey: 'resellers', cap: 'resellerView' },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      { href: '/hq/catalog', labelKey: 'catalog', cap: 'catalogWrite' },
      { href: '/hq/loyalty', labelKey: 'loyalty', cap: 'rewardCatalog' },
      { href: '/hq/subscriptions', labelKey: 'subscriptions', cap: 'hqBackOffice' },
    ],
  },
  {
    headKey: 'forms',
    items: [
      { href: '/hq/forms/pricing-rule', labelKey: 'formPricingRule', cap: 'depotAdmin' },
      { href: '/hq/forms/voucher', labelKey: 'formVoucher', cap: 'voucherWrite' },
      { href: '/hq/forms/commission', labelKey: 'formCommission', cap: 'commissionRead' },
      { href: '/hq/forms/segment', labelKey: 'formSegment', cap: 'campaignWrite' },
      { href: '/hq/staff/import', labelKey: 'staffImport', cap: 'staffAdmin' },
      { href: '/hq/broadcast', labelKey: 'broadcast', cap: 'campaignWrite' },
    ],
  },
  {
    headKey: 'flow',
    items: [
      { href: '/hq/incidents', labelKey: 'incidents', cap: 'hqBackOffice' },
      { href: '/hq/tickets', labelKey: 'tickets', cap: 'hqBackOffice' },
      { href: '/hq/fraud', labelKey: 'fraud', cap: 'fraudReview' },
      { href: '/hq/scheduled-reports', labelKey: 'scheduledReports', cap: 'hqBackOffice' },
      { href: '/hq/onboarding', labelKey: 'onboarding', cap: 'depotDirectory' },
    ],
  },
  {
    headKey: 'system',
    items: [
      { href: '/hq/audit', labelKey: 'audit', cap: 'hqBackOffice' },
      { href: '/hq/flags', labelKey: 'flags', cap: 'platformAdmin' },
      { href: '/hq/health', labelKey: 'health', cap: 'hqBackOffice' },
      { href: '/hq/exports', labelKey: 'exports', cap: 'hqBackOffice' },
      { href: '/hq/api-keys', labelKey: 'apiKeys', cap: 'platformAdmin' },
      { href: '/hq/webhooks', labelKey: 'webhooks', cap: 'platformAdmin' },
      { href: '/hq/sla-policy', labelKey: 'slaPolicy', cap: 'depotAdmin' },
      { href: '/hq/forecast-models', labelKey: 'forecastModels', cap: 'forecast' },
      { href: '/hq/retention', labelKey: 'retention', cap: 'platformAdmin' },
      { href: '/hq/pdp', labelKey: 'pdp', cap: 'pdpRequests' },
      { href: '/hq/security', labelKey: 'security', cap: 'platformAdmin' },
    ],
  },
  {
    headKey: 'admin',
    items: [
      { href: '/hq/profile', labelKey: 'profile', cap: 'ownNotifPrefs' },
      { href: '/hq/wizard', labelKey: 'wizard', cap: 'platformAdmin' },
      { href: '/hq/invoice-template', labelKey: 'invoiceTemplate', cap: 'taxSettings' },
      { href: '/hq/content', labelKey: 'content', cap: 'platformAdmin' },
      // The screen index. It renders `hqGroupsForRole` — it shows a role only what that
      // role can already reach — so the door it needs is the console door itself.
      { href: '/hq/sitemap', labelKey: 'sitemap', cap: 'hqConsole' },
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
