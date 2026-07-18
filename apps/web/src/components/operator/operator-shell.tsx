'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Drop } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';

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

type Tab = { label: string; href: string; match: (p: string) => boolean };

const primaryTabs: Tab[] = [
  { label: 'Ringkasan', href: '/dashboard', match: (p) => p === '/dashboard' },
  { label: 'Antrean', href: '/dashboard/orders', match: (p) => p.startsWith('/dashboard/orders') },
  { label: 'Kurir', href: '/dashboard/tracking', match: (p) => p.startsWith('/dashboard/tracking') },
  { label: 'Inventory', href: '/dashboard/inventory', match: (p) => p.startsWith('/dashboard/inventory') },
  { label: 'Retur', href: '/dashboard/returns', match: (p) => p.startsWith('/dashboard/returns') },
  { label: 'Setoran', href: '/dashboard/settlements', match: (p) => p.startsWith('/dashboard/settlements') },
];

const manageTabs: Tab[] = [
  { label: 'Pelanggan', href: '/dashboard/customers', match: (p) => p.startsWith('/dashboard/customers') },
  { label: 'Insiden', href: '/dashboard/incidents', match: (p) => p.startsWith('/dashboard/incidents') },
  { label: 'Promo', href: '/dashboard/promotions', match: (p) => p.startsWith('/dashboard/promotions') },
  { label: 'Broadcast', href: '/dashboard/broadcast', match: (p) => p.startsWith('/dashboard/broadcast') },
  { label: 'Shift', href: '/dashboard/shift', match: (p) => p.startsWith('/dashboard/shift') },
  { label: 'Huddle', href: '/dashboard/huddle', match: (p) => p.startsWith('/dashboard/huddle') },
  { label: 'Serah terima', href: '/dashboard/handover', match: (p) => p.startsWith('/dashboard/handover') },
  { label: 'Perawatan', href: '/dashboard/maintenance', match: (p) => p.startsWith('/dashboard/maintenance') },
  { label: 'Kelola depot', href: '/dashboard/depots', match: (p) => p.startsWith('/dashboard/depots') },
  { label: 'Pembayaran', href: '/dashboard/payments', match: (p) => p.startsWith('/dashboard/payments') },
  { label: 'Notifikasi', href: '/dashboard/notifications', match: (p) => p.startsWith('/dashboard/notifications') },
  { label: 'Laporan', href: '/dashboard/reports', match: (p) => p.startsWith('/dashboard/reports') },
  { label: 'Audit', href: '/dashboard/audit', match: (p) => p.startsWith('/dashboard/audit') },
  { label: 'Pengaturan', href: '/dashboard/operator-settings', match: (p) => p.startsWith('/dashboard/operator-settings') },
];

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      className={`shrink-0 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition ${
        active
          ? 'bg-brand-50 text-brand-800'
          : 'text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]'
      }`}
    >
      {tab.label}
    </Link>
  );
}

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/dashboard';
  const { customer } = useAuth();
  const { selected, depots } = useDepot();
  const depot = selected ?? depots[0] ?? null;
  const name = customer?.fullName ?? 'Operator';

  return (
    <div className="flex min-h-screen flex-col">
      {/* Franchise header */}
      <header className="surface border-b border-app">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600">
            <Drop size={19} weight="fill" className="text-white" />
          </span>
          <span className="text-[15px] font-extrabold">{depot?.name ?? 'Hydromart'}</span>
          <span className="rounded-md bg-brand-50 px-2 py-[3px] text-[10px] font-extrabold tracking-wide text-brand-800">
            WARALABA
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-[10px] bg-[color:var(--surface-soft)]">
              <Bell size={18} className="text-[color:var(--text-muted)]" />
              <span className="absolute right-[9px] top-2 h-[7px] w-[7px] rounded-full bg-[color:var(--danger)]" />
            </span>
            <span className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-800 text-[13px] font-extrabold text-white">
                {initials(name)}
              </span>
              <span className="hidden sm:block">
                <span className="block text-[12.5px] font-extrabold leading-tight">{name}</span>
                <span className="block text-[10.5px] text-[color:var(--text-muted)]">Operator depot</span>
              </span>
            </span>
          </div>
        </div>
        {/* Tab bar */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:px-5">
          {primaryTabs.map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(pathname)} />
          ))}
          <span className="mx-1 my-1 w-px shrink-0 bg-[color:var(--border)]" />
          {manageTabs.map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(pathname)} />
          ))}
        </nav>
      </header>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
