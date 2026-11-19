'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { usePathname } from 'next/navigation';
import { Bell, Drop } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useOpsNotifications } from '@/lib/ops-notifications';
import { useDepot } from '@/lib/depot-context';
import { hubsFor } from '@/lib/ops-nav';
import { deepest, normalisePath } from '@/lib/screen-chrome';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// The Depot Operator console chrome (design: Depot Operator.dc.html). Unlike the
// manager's left rail, operators get a top-tab console — a franchise header
// (drop logo · depot name · WARALABA badge · user chip) over a horizontal tab bar
// grouping the operator's job-to-be-done: Ringkasan · Antrean · Kurir · Inventory ·
// Retur · Setoran, plus the "Kelola depot" management group. Every tab links to a
// /dashboard/* route; the active tab is derived from the current path.

type Tab = {
  label: string;
  href: string;
};

/*
 * Each primary tab is shown only when the table row for its screen lets the role in: the same
 * gate the rail and the Kelola tabs use, read off `hubsFor` rather than restated here. Six of
 * the seven had no gate of their own, which held only while every head of depot carried every
 * capability; a built-in role edited in /hq/access could leave a tab that opened onto a denial.
 * A tab whose screen has no row is not shown: `flow-3b-hubs.test.tsx` pins all seven to a row.
 */
const primaryTabs: Tab[] = [
  { label: 'hrFix.opNav.summary', href: '/dashboard' },
  { label: 'hrFix.opNav.queue', href: '/dashboard/orders' },
  // The operator IS the cashier — the counter sale belongs in their primary tabs, not the
  // manager's left rail (which this role never sees).
  { label: 'hrFix.opNav.sales', href: '/dashboard/walk-in' },
  { label: 'hrFix.opNav.couriers', href: '/dashboard/tracking' },
  { label: 'hrFix.opNav.inventory', href: '/dashboard/inventory' },
  { label: 'hrFix.opNav.returns', href: '/dashboard/returns' },
  { label: 'hrFix.opNav.settlements', href: '/dashboard/settlements' },
];

// Flow PR-3b: the "Kelola" tabs ARE the depot-console table (lib/ops-nav): one tab per hub
// the role sees that the primary row does not already stand for. Each opens the hub's first
// screen, where HubTabs lists the rest, and each screen carries the gate of its row. Kept by
// hand, 21 tabs had no gate at all, and one (Kelola depot) led a head of depot to a page they
// may not open. A primary tab stands for its whole hub: on Meteran, Inventory is lit.
const PRIMARY = new Set(primaryTabs.map((tab) => tab.href));

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  const { t } = useT();
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-[12.5px] font-semibold transition ${
        active
          ? 'bg-brand-50 text-brand-800'
          : 'text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]'
      }`}
    >
      {t(tab.label)}
    </Link>
  );
}

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  // `trailingSlash: true` in the APK export: compare `/dashboard`, never `/dashboard/`.
  const pathname = normalisePath(usePathname() ?? '/dashboard');
  const { customer } = useAuth();
  const { selected, depots } = useDepot();
  const depot = selected ?? depots[0] ?? null;
  const { unreadCount: unread } = useOpsNotifications();
  const name = customer?.fullName ?? 'Operator';
  const role = customer?.role;
  const hubs = hubsFor(role);
  const open = new Set(hubs.flatMap((h) => h.items.map((i) => i.href)));
  const primary = primaryTabs.filter((tab) => open.has(tab.href));
  const kelola = hubs.filter((h) => !h.items.some((i) => PRIMARY.has(i.href)));
  // One current tab across both rows, by the rail's rule (flow-1e): the deepest screen wins,
  // so an order detail screen lights Antrean and nothing else.
  const current = deepest(
    hubs.flatMap((h) => h.items),
    pathname,
    '/dashboard',
  )?.href;
  const hubOfScreen = (href: string | undefined) =>
    hubs.find((h) => h.items.some((i) => i.href === href))?.hub.headKey;
  const lit =
    primary.find((tab) => tab.href === current) ??
    primary.find((tab) => hubOfScreen(tab.href) === hubOfScreen(current));

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Franchise header */}
      <header className="surface border-b border-app">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600">
            <Drop size={19} weight="fill" className="text-white" />
          </span>
          <span className="text-[15px] font-extrabold">{depot?.name ?? 'Hydromart'}</span>
          {/* The literal WARALABA badge is gone. It labelled every depot a franchise,
              including the ones head office owns outright, and there is nothing to source
              it from at this role: ownershipType lives on the depotAdmin listing (MANAGER,
              SUPER_ADMIN), and the public browse view deliberately omits it — that view was
              trimmed precisely because it used to publish depot detail to the open internet. */}
          <div className="ml-auto flex items-center gap-3">
            {/* The bell was an icon that did nothing under a red dot that was always on —
                so it reported unread alerts on a depot with none, and could not be opened
                to find out. Real count, real destination. */}
            <Link
              href="/dashboard/notifications"
              aria-label={
                unread > 0
                  ? t('hrFix.operatorShell.notifUnreadAria', { n: unread })
                  : t('hrFix.operatorShell.notifAria')
              }
              className="relative flex h-11 w-11 items-center justify-center rounded-[10px] bg-[color:var(--surface-soft)] hover:bg-brand-50"
            >
              <Bell size={18} className="text-[color:var(--text-muted)]" />
              {unread > 0 && (
                <span className="absolute right-[9px] top-2 h-[7px] w-[7px] rounded-full bg-[color:var(--danger)]" />
              )}
            </Link>
            <span className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-800 text-[13px] font-extrabold text-white">
                {initials(name)}
              </span>
              <span className="hidden sm:block">
                <span className="block text-[12.5px] font-extrabold leading-tight">{name}</span>
                <span className="block text-[10.5px] text-[color:var(--text-muted)]">
                  {t('hrFix.operatorShell.title')}
                </span>
              </span>
            </span>
          </div>
        </div>
        {/* Tab bar */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:px-5">
          {primary.map((tab) => (
            <TabLink key={tab.href} tab={tab} active={tab === lit} />
          ))}
          <span className="mx-1 my-1 w-px shrink-0 bg-[color:var(--border)]" />
          {kelola.map(({ hub, items }) => (
            <TabLink
              key={hub.headKey}
              tab={{ label: `ops.groups.${hub.headKey}`, href: items[0]!.href }}
              active={!lit && items.some((i) => i.href === current)}
            />
          ))}
        </nav>
      </header>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
