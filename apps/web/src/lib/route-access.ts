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
 */
import { GROUPS } from '@/components/dashboard/ops-rail';
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
} from '@/lib/roles';
import { normalisePath } from '@/lib/screen-chrome';

type Role = string | null | undefined;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The deepest row `path` sits under, so `/dashboard/franchise/attendance` beats its parent. */
function deepest<T extends { href: string }>(items: readonly T[], path: string): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (under(path, item.href) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

// The rail's `/dashboard` row is a door for rail users only; the page itself has its own gate.
const DEPOT_ROWS = GROUPS.flatMap((g) => g.items).filter(
  (i) => i.href !== '/dashboard' && under(i.href, '/dashboard'),
);

function pageAllows(path: string, role: Role): boolean {
  if (under(path, '/hq')) {
    if (path === '/hq/login') return true;
    const cap = capForHqPath(path);
    return mayOpenHqPath(role, path) && (!cap || can(cap, role));
  }
  // The depot home serves the operator and the franchise owner too, neither holding `dashboard`.
  if (path === '/dashboard') return dashboardLandingView(role) !== 'denied';
  if (under(path, '/dashboard')) {
    // ponytail: a screen with no rail row keeps its own gate; hiding its link would be a guess.
    return deepest(DEPOT_ROWS, path)?.show(role) ?? true;
  }
  // Self-service answers only for the caller's own employee record, so signed in is the gate.
  if (under(path, '/hr/me')) return !!role;
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

/** True only when `role` passes the page's gate AND this build serves the route. */
export function canOpenRoute(href: string, role: Role): boolean {
  const path = normalisePath(href.split(/[?#]/, 1)[0] ?? '');
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

/** `href` as the console asking for it spells it: its twin when it has one, unchanged otherwise. */
export function twinFor(href: string, side: ConsoleSide): string {
  const cut = href.search(/[?#]/);
  const path = normalisePath(cut === -1 ? href : href.slice(0, cut));
  const pair = TWINS.find(([hq, depot]) => path === hq || path === depot);
  if (!pair) return href;
  return (side === 'hq' ? pair[0] : pair[1]) + (cut === -1 ? '' : href.slice(cut));
}
