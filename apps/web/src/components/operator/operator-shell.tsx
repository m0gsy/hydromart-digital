'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { usePathname } from 'next/navigation';
import { Bell, Drop } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useOpsNotifications } from '@/lib/ops-notifications';
import { useDepot } from '@/lib/depot-context';
import { GROUPS } from '@/lib/ops-nav';
import { normalisePath } from '@/lib/screen-chrome';
import { can } from '@/lib/roles';

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
  match: (p: string) => boolean;
  /** Hide the tab when the role lacks what the page behind it needs. */
  show?: (role: string | null | undefined) => boolean;
};

const primaryTabs: Tab[] = [
  { label: 'hrFix.opNav.summary', href: '/dashboard', match: (p) => p === '/dashboard' },
  { label: 'hrFix.opNav.queue', href: '/dashboard/orders', match: (p) => p.startsWith('/dashboard/orders'), show: (r) => can('orderManageRead', r) },
  // The operator IS the cashier — the counter sale belongs in their primary tabs, not the
  // manager's left rail (which this role never sees).
  { label: 'hrFix.opNav.sales', href: '/dashboard/walk-in', match: (p) => p.startsWith('/dashboard/walk-in') },
  { label: 'hrFix.opNav.couriers', href: '/dashboard/tracking', match: (p) => p.startsWith('/dashboard/tracking') },
  { label: 'hrFix.opNav.inventory', href: '/dashboard/inventory', match: (p) => p.startsWith('/dashboard/inventory') },
  { label: 'hrFix.opNav.returns', href: '/dashboard/returns', match: (p) => p.startsWith('/dashboard/returns') },
  { label: 'hrFix.opNav.settlements', href: '/dashboard/settlements', match: (p) => p.startsWith('/dashboard/settlements') },
];

// Flow PR-3b: the "Kelola" tabs ARE the depot-console table (lib/ops-nav), less what the
// primary row above already holds, so each carries the gate of its row. Kept by hand, 21 of
// them had no gate at all, and one (Kelola depot) led a head of depot to a page they may not
// open. A new screen in the table now reaches this console too, with its gate.
const PRIMARY = new Set(primaryTabs.map((tab) => tab.href));
const manageTabs: Tab[] = GROUPS.flatMap((g) => g.items)
  .filter((item) => !PRIMARY.has(item.href))
  .map((item) => ({
    label: `ops.nav.${item.labelKey}`,
    href: item.href,
    match: (p) => p === item.href || p.startsWith(`${item.href}/`),
    show: item.show,
  }));

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
              aria-label={unread > 0 ? t('hrFix.operatorShell.notifUnreadAria', { n: unread }) : t('hrFix.operatorShell.notifAria')}
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
                <span className="block text-[10.5px] text-[color:var(--text-muted)]">{t('hrFix.operatorShell.title')}</span>
              </span>
            </span>
          </div>
        </div>
        {/* Tab bar */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:px-5">
          {primaryTabs.filter((t) => !t.show || t.show(customer?.role)).map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(pathname)} />
          ))}
          <span className="mx-1 my-1 w-px shrink-0 bg-[color:var(--border)]" />
          {manageTabs.filter((t) => !t.show || t.show(customer?.role)).map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(pathname)} />
          ))}
        </nav>
      </header>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
