// The /hq navigation model: which screens exist, which capability each needs, and the two
// questions both the rail and the layout ask of it.
//
// Data, not a component. `lib/roles.ts` needs `hqItemsForRole` to answer "where does this
// role land", and importing a component into lib is a cycle — the rail already imports
// `can`/`isHq` from roles. Splitting the table out is what lets one table answer the rail,
// the page gate and the landing, instead of three copies drifting apart.

import { can, isHq, type Capability } from '@/lib/roles';
import { deepest, normalisePath } from '@/lib/screen-chrome';

/** Same shape `roles.ts` uses: whatever the session says, including nothing. */
type Role = string | null | undefined;

export interface HqRailItem {
  href: string;
  // i18n key under hq.nav.*
  labelKey: string;
  /**
   * The capability this screen needs. REQUIRED — every item in HQ_GROUPS carries one.
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
  // i18n key under hq.groups.* — the hub's name (flow PR-3c).
  headKey: string;
  /** PR-3c: a group no rail shows; its screens are buttons on the lists they add to. */
  pageOnly?: true;
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
      { href: '/hq/notifications', labelKey: 'notifications', cap: 'opsNotif' },
    ],
  },
  {
    headKey: 'analytics',
    items: [
      // The tabbed dashboard. First of this group (not beside `/hq`) so the roles that land on the
      // first readable row, and the three phone tabs, are the same as before it existed.
      { href: '/hq/dashboard', labelKey: 'insight', cap: 'dashboardFinance' },
      { href: '/hq/analytics', labelKey: 'analytics', cap: 'dashboard' },
      { href: '/hq/scorecard', labelKey: 'scorecard', cap: 'dashboard' },
      { href: '/hq/compare', labelKey: 'compare', cap: 'dashboard' },
      { href: '/hq/forecast', labelKey: 'forecast', cap: 'forecast' },
      { href: '/hq/churn', labelKey: 'churn', cap: 'churn' },
    ],
  },
  {
    headKey: 'search',
    items: [{ href: '/hq/search', labelKey: 'search', cap: 'depotDirectoryFinance' }],
  },
  {
    headKey: 'network',
    items: [
      { href: '/hq/depots', labelKey: 'depots', cap: 'depotDirectory' },
      { href: '/hq/hierarchy', labelKey: 'hierarchy', cap: 'hierarchyAdmin' },
      { href: '/hq/applications', labelKey: 'applications', cap: 'franchiseApplications' },
      { href: '/hq/onboarding', labelKey: 'onboarding', cap: 'depotDirectory' },
    ],
  },
  {
    headKey: 'franchise',
    items: [
      { href: '/hq/franchise', labelKey: 'franchise', cap: 'hqPayoutRead' },
      { href: '/hq/reconciliation', labelKey: 'reconciliation', cap: 'commissionRead' },
    ],
  },
  {
    headKey: 'opsConsole',
    items: [
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
      { href: '/hq/access', labelKey: 'access', cap: 'accessMatrixWrite' },
    ],
  },
  {
    headKey: 'hr',
    items: [{ href: '/hr', labelKey: 'hr', cap: 'hrView' }],
  },
  {
    headKey: 'operations',
    items: [
      { href: '/hq/orders', labelKey: 'orders', cap: 'orderManageRead' },
      { href: '/hq/inventory', labelKey: 'inventory', cap: 'inventoryRead' },
      { href: '/hq/returns', labelKey: 'returns', cap: 'returnsRead' },
      { href: '/hq/roster', labelKey: 'roster', cap: 'driverRoster' },
    ],
  },
  {
    headKey: 'finance',
    items: [
      { href: '/hq/payments', labelKey: 'payments', cap: 'hqPayoutRead' },
      { href: '/hq/refunds', labelKey: 'refunds', cap: 'refundQueueRead' },
      // The finance work screens live under /dashboard (the depot console's own screens,
      // network-wide for FINANCE). The rail had no door to them, so they were reachable only
      // by typing the URL. `cap` is what each page's server calls check.
      { href: '/dashboard/settlements', labelKey: 'settlements', cap: 'courierSettle' },
      { href: '/dashboard/expense-claims', labelKey: 'expenseClaims', cap: 'expenseApprove' },
      { href: '/dashboard/earning-rules', labelKey: 'earningRules', cap: 'earningRules' },
      { href: '/dashboard/cashbook', labelKey: 'cashbook', cap: 'depotFinance' },
      // CA-2-59: the network P&L. Same capability as the revenue roll-up it completes —
      // whoever may read what the network SOLD may read what it cost to make.
      { href: '/hq/pnl', labelKey: 'pnl', cap: 'dashboard' },
      { href: '/hq/reports/export', labelKey: 'reportsExport', cap: 'orderReports' },
      { href: '/hq/tax', labelKey: 'tax', cap: 'taxSettings' },
      { href: '/hq/invoice-template', labelKey: 'invoiceTemplate', cap: 'taxSettings' },
    ],
  },
  {
    headKey: 'catalog',
    items: [
      { href: '/hq/catalog', labelKey: 'catalog', cap: 'catalogWrite' },
      { href: '/hq/pricing', labelKey: 'pricing', cap: 'priceOverrideDecide' },
      { href: '/hq/loyalty', labelKey: 'loyalty', cap: 'rewardCatalog' },
      { href: '/hq/subscriptions', labelKey: 'subscriptions', cap: 'hqBackOffice' },
    ],
  },
  {
    headKey: 'marketing',
    items: [
      { href: '/hq/campaigns', labelKey: 'campaigns', cap: 'campaignRead' },
      { href: '/hq/promotions', labelKey: 'promotions', cap: 'promotionRead' },
      { href: '/hq/promo-rules', labelKey: 'promoRules', cap: 'promoRuleRead' },
      { href: '/hq/vouchers', labelKey: 'vouchers', cap: 'voucherRead' },
      // Depot managers reach the same screen from the ops rail (J10).
      { href: '/resellers', labelKey: 'resellers', cap: 'resellerView' },
    ],
  },
  {
    headKey: 'service',
    items: [
      { href: '/hq/customers', labelKey: 'customers', cap: 'customerPhoneLookup' },
      { href: '/hq/tickets', labelKey: 'tickets', cap: 'hqBackOffice' },
      { href: '/hq/fraud', labelKey: 'fraud', cap: 'fraudReview' },
      { href: '/hq/pdp', labelKey: 'pdp', cap: 'pdpRequests' },
    ],
  },
  {
    headKey: 'system',
    items: [
      { href: '/hq/incidents', labelKey: 'incidents', cap: 'hqBackOffice' },
      { href: '/hq/health', labelKey: 'health', cap: 'hqBackOffice' },
      { href: '/hq/audit', labelKey: 'audit', cap: 'hqBackOffice' },
      { href: '/hq/exports', labelKey: 'exports', cap: 'hqBackOffice' },
      { href: '/hq/scheduled-reports', labelKey: 'scheduledReports', cap: 'hqBackOffice' },
      { href: '/hq/sla-policy', labelKey: 'slaPolicy', cap: 'hqBackOffice' },
      { href: '/hq/forecast-models', labelKey: 'forecastModels', cap: 'forecast' },
      { href: '/hq/flags', labelKey: 'flags', cap: 'platformAdmin' },
      { href: '/hq/api-keys', labelKey: 'apiKeys', cap: 'platformAdmin' },
      { href: '/hq/webhooks', labelKey: 'webhooks', cap: 'platformAdmin' },
      { href: '/hq/retention', labelKey: 'retention', cap: 'platformAdmin' },
      { href: '/hq/security', labelKey: 'security', cap: 'platformAdmin' },
      { href: '/hq/policy-changes', labelKey: 'policyChanges', cap: 'platformAdmin' },
      { href: '/hq/wizard', labelKey: 'wizard', cap: 'platformAdmin' },
      { href: '/hq/content', labelKey: 'content', cap: 'platformAdmin' },
      // PR-3c review: personal and index screens close the Sistem hub, so a role without the
      // overview is not sent to its profile by a row named Ringkasan.
      { href: '/hq/profile', labelKey: 'profile', cap: 'ownNotifPrefs' },
      // The screen index. It renders `hqGroupsForRole` — it shows a role only what that
      // role can already reach — so the door it needs is the console door itself.
      { href: '/hq/sitemap', labelKey: 'sitemap', cap: 'hqConsole' },
    ],
  },
  {
    headKey: 'forms',
    // PR-3c: "Formulir" is gone from the rail — each form is a button on the list it adds to.
    // The rows stay here so the gate of each is still this one table.
    pageOnly: true,
    items: [
      { href: '/hq/forms/pricing-rule', labelKey: 'formPricingRule', cap: 'depotAdmin' },
      { href: '/hq/forms/voucher', labelKey: 'formVoucher', cap: 'voucherWrite' },
      { href: '/hq/forms/commission', labelKey: 'formCommission', cap: 'commissionRead' },
      { href: '/hq/staff/import', labelKey: 'staffImport', cap: 'staffAdmin' },
      { href: '/hq/depots/import', labelKey: 'depotImport', cap: 'depotLifecycle' },
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
  const partial = PARTIAL_HQ_DOOR[role as string];
  if (!isHq(role) && !partial) return [];
  return HQ_GROUPS.map((g) => ({
    ...g,
    // `cap` filters on top of the console gate: an item whose capability this role lacks is
    // not shown at all, rather than shown and then refused by the server. A role with only
    // a PARTIAL door sees nothing outside its own list, whatever else it happens to hold.
    items: g.items.filter((i) => can(i.cap, role) && (!partial || partial.includes(i.href))),
  })).filter((g) => g.items.length > 0);
}

/**
 * Roles that are NOT head office but own a handful of /hq screens with no depot-console
 * twin. Owner decision 2026-10-15 (MARKETING): the console stays closed — `isHq` is what
 * lands a user on /hq at sign-in, and MARKETING keeps its own console as home — and only
 * these doors open. An allow-list rather than "every item whose cap you hold", because a
 * role can hold a capability for a screen the owner never meant it to browse.
 */
export const PARTIAL_HQ_DOOR: Record<string, readonly string[] | undefined> = {
  MARKETING: [
    '/hq/loyalty', // rewardCatalog
    '/hq/customers', // customerPhoneLookup + loyaltyAdjust/loyaltyRead
    '/hq/campaigns', // campaignRead: schedule
    // Flow 5c: both now only redirect to the campaign builder; kept so an old link lands there.
    '/hq/forms/segment',
    '/hq/broadcast',
  ],
};

export function hasPartialHqDoor(role: Role): boolean {
  return PARTIAL_HQ_DOOR[role as string] !== undefined;
}

/** May this role open this /hq path? Full console roles defer to `capForHqPath`. */
export function mayOpenHqPath(role: Role, pathname: string | null | undefined): boolean {
  if (isHq(role)) return true;
  const allowed = PARTIAL_HQ_DOOR[role as string];
  if (!allowed || !pathname) return false;
  return allowed.some((h) => pathname === h || pathname.startsWith(h + '/'));
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
  const at = MOVED[normalisePath(pathname)] ?? pathname;
  let best: { href: string; cap?: Capability } | null = null;
  for (const group of HQ_GROUPS) {
    for (const item of group.items) {
      if (at !== item.href && !at.startsWith(`${item.href}/`)) continue;
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.cap ?? null;
}

/**
 * Flow 5c: screens folded into another. Their routes only redirect, gated as the screen they
 * lead to: without a row of their own they fell to the overview's gate, and the role the old
 * screen was for met a refusal instead of the redirect.
 */
const MOVED: Record<string, string> = {
  '/hq/broadcast': '/hq/campaigns',
  '/hq/forms/segment': '/hq/campaigns',
};

/**
 * Flow PR-3c: the HQ hubs a role sees. The rail and the phone bar show one row per hub; the
 * hub's screens are tabs on top of each of them (`components/hq/hq-hub-tabs.tsx`).
 */
export function hqHubsFor(role: Role): HqRailGroup[] {
  return hqGroupsForRole(role).filter((g) => !g.pageOnly);
}

/** The hub whose screen `path` IS (normalised), as `role` sees it; a detail below one is not. */
export function hqHubOf(path: string, role: Role): HqRailGroup | undefined {
  const at = normalisePath(path);
  return hqHubsFor(role).find((g) => g.items.some((i) => i.href === at));
}

/**
 * PR-3c: where a console role's day starts, its hub of work, ahead of the rest. FINANCE used to
 * land on `/hq/search`, merely the first screen in table order it could open.
 */
export const HQ_WORK_HUB: Record<string, string | undefined> = { FINANCE: 'finance' };

/** The role's hubs in landing order: its work hub first, then the rail's order. */
export function hqHubsInLandingOrder(role: Role): HqRailGroup[] {
  const work = HQ_WORK_HUB[role as string];
  const hubs = hqHubsFor(role);
  return [...hubs.filter((g) => g.headKey === work), ...hubs.filter((g) => g.headKey !== work)];
}

/** The role's HQ screens in landing order. */
export function hqLandingItems(role: Role): HqRailItem[] {
  return hqHubsInLandingOrder(role).flatMap((g) => g.items);
}

/**
 * A form reached by a button belongs to the list the button is on. The imports already sit
 * under their list's path; these three do not.
 */
const FORM_LIST: Record<string, string> = {
  '/hq/forms/pricing-rule': '/hq/pricing',
  '/hq/forms/voucher': '/hq/vouchers',
  '/hq/forms/commission': '/hq/reconciliation',
};

/**
 * The hub the screen at `path` belongs to, as `role` sees it: the hub of its deepest hub
 * screen, and for a form, the hub of its list. One rule for the rail, the bar and its sheet.
 */
export function currentHqHub(path: string, role: Role): string | undefined {
  const at = normalisePath(path);
  const hubs = hqHubsFor(role);
  const screen = deepest(
    hubs.flatMap((g) => g.items),
    FORM_LIST[at] ?? at,
    '/hq',
  )?.href;
  return hubs.find((g) => g.items.some((i) => i.href === screen))?.headKey;
}

/**
 * May this role open this /hq screen? The HQ layout's own gate (console door, partial door,
 * the screen's capability), without lib/route-access, which bundles every rail's icons into
 * the page that asks (flow PR-4: +44-53 kB on the screens that asked through it).
 */
export function canOpenHqPath(role: Role, path: string): boolean {
  const cap = capForHqPath(path);
  return mayOpenHqPath(role, path) && (!cap || can(cap, role));
}
