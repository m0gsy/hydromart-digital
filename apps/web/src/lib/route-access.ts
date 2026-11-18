/**
 * PR-1a: may this role open this link HERE?
 *
 * A link is worth drawing only if the reader lands on the page behind it. That takes two
 * things, and the links that broke were each missing one: the role must pass the page's own
 * gate (Insight sent MANAGER to /hq screens that refuse it), and this binary must carry the
 * route at all (the Ops app has no /hq). Search results, ⌘K, widget "see detail" links and
 * the doors to the order queue all ask the same question, so they ask it here.
 *
 * Every gate is borrowed, never restated: the /hq table and its partial doors from
 * `hq-nav`, the depot rail's own `show()`, the HR rail's row gates and the console-entry
 * checks the phone shells use. A second copy of any of them is a door that drifts.
 *
 * ponytail: a screen is judged by the rail row it sits under. Two known ceilings, both closed
 * by PR-3's "item gate = page gate" invariant rather than by a second table here:
 * - a row stricter than its page hides a link that would have worked (`/dashboard/depots`
 *   rows on `depotAdmin`, the page reads on `depotDirectory`);
 * - a child stricter than its row is not seen (`/hr/attendance/import` needs `hrAdmin`).
 *   Give such a child its own row before anything links to it.
 * The ops table is data in `lib/ops-nav.ts` (PR-3a), icons included, so every caller still
 * bundles them; HR_ITEMS is still read from the HR rail component.
 */
import { GROUPS } from '@/lib/ops-nav';
import { HR_ITEMS } from '@/components/hr/hr-rail';
import { isServedHere } from '@/lib/deep-link';
import { capForHqPath, mayOpenHqPath } from '@/lib/hq-nav';
import {
  can,
  canManageHr,
  canUseCourierApp,
  canUseManagerConsole,
  canViewHr,
  canViewResellers,
  dashboardLandingView,
  isStaff,
} from '@/lib/roles';
import { normalisePath } from '@/lib/screen-chrome';

type Role = string | null | undefined;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** `[path, '?query#hash']`, the path with no trailing slash. */
function splitHref(href: string): [string, string] {
  const cut = href.search(/[?#]/);
  return cut === -1
    ? [normalisePath(href), '']
    : [normalisePath(href.slice(0, cut)), href.slice(cut)];
}

/** The deepest row `path` sits under, so `/dashboard/franchise/attendance` beats its parent. */
function deepest<T extends { href: string }>(items: readonly T[], path: string): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (under(path, item.href) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/*
 * The rail's `/dashboard` row is a door for rail users only; the page has its own gate.
 * Read on first use, not at import: a rail that one day asks `canOpenRoute` would otherwise
 * meet its own `GROUPS` before it exists.
 */
let depotRows: (typeof GROUPS)[number]['items'] | undefined;
const depotRowsOnce = () =>
  (depotRows ??= GROUPS.flatMap((g) => g.items).filter(
    (i) => i.href !== '/dashboard' && under(i.href, '/dashboard'),
  ));

function pageAllows(path: string, role: Role): boolean {
  if (under(path, '/hq')) {
    if (path === '/hq/login') return true;
    const cap = capForHqPath(path);
    return mayOpenHqPath(role, path) && (!cap || can(cap, role));
  }
  // The depot home serves the operator and the franchise owner too, neither holding `dashboard`.
  if (path === '/dashboard') return dashboardLandingView(role) !== 'denied';
  if (under(path, '/dashboard')) {
    // A screen with no rail row keeps its own say; it is still a staff screen.
    return isStaff(role) && (deepest(depotRowsOnce(), path)?.show(role) ?? true);
  }
  // Self-service answers for the caller's own employee record: any staff account, no customer.
  if (under(path, '/hr/me')) return isStaff(role);
  if (under(path, '/hr')) {
    const row = deepest(HR_ITEMS, path);
    return (
      canViewHr(role) && (!row?.adminOnly || canManageHr(role)) && (!row?.can || can(row.can, role))
    );
  }
  if (under(path, '/driver')) return canUseCourierApp(role);
  if (under(path, '/m/manager')) return path === '/m/manager/login' || canUseManagerConsole(role);
  if (under(path, '/resellers')) return canViewResellers(role);
  return true;
}

/**
 * True only when `href` is a path in this app, `role` passes its page's gate, and this build
 * serves the route. Anything else — an absolute URL, a relative path — it cannot vouch for.
 */
export function canOpenRoute(href: string, role: Role): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  const [path] = splitHref(href);
  return isServedHere(path) && pageAllows(path, role);
}

export type ConsoleSide = 'hq' | 'dashboard';

/** The same figures, once per console: the network view under /hq, one depot's under /dashboard. */
const TWINS: ReadonlyArray<readonly [hq: string, depot: string]> = [
  ['/hq/churn', '/dashboard/churn'],
  ['/hq/compare', '/dashboard/compare'],
  ['/hq/inventory', '/dashboard/inventory'],
  ['/hq/pnl', '/dashboard/monthly-pnl'],
];

/**
 * `href` as the console asking for it spells it: its twin when it has one, unchanged
 * otherwise. Says nothing about whether the result opens — ask `canOpenRoute` of what it returns.
 */
export function twinFor(href: string, side: ConsoleSide): string {
  const [path, rest] = splitHref(href);
  const pair = TWINS.find(([hq, depot]) => path === hq || path === depot);
  if (!pair) return href;
  return (side === 'hq' ? pair[0] : pair[1]) + rest;
}
