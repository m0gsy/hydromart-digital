'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChartBar, Gavel, House, User } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

const TABS = [
  { href: '/m/manager', label: 'Beranda', icon: House },
  { href: '/m/manager/approvals', label: 'Approval', icon: Gavel },
  { href: '/m/manager/notifications', label: 'Notif', icon: Bell },
  { href: '/m/manager/team', label: 'Tim', icon: ChartBar },
  { href: '/m/manager/account', label: 'Akun', icon: User },
] as const;

/** Bottom tab bar — 5 tabs per the Depot Manager Mobile design (cells 1b–3a). */
function ManagerNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 flex border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === '/m/manager' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold ${
              active ? 'text-brand-700' : 'text-[color:var(--muted)]'
            }`}
          >
            <Icon size={22} weight={active ? 'fill' : 'regular'} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Depot-manager phone frame: DEPOT_MANAGER-only gate + bottom nav. Sign-in itself is
 * handled by RequireAuth in the route layout; this only checks the manager role.
 * `nav={false}` for full-bleed detail flows (approval detail) that own the whole screen.
 */
export function ManagerShell({
  children,
  nav = true,
}: {
  children: React.ReactNode;
  nav?: boolean;
}) {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState icon={<House size={32} />} title="Halaman khusus manajer depot">
        Akun ini bukan manajer depot. Masuk dengan akun manajer untuk membuka konsol ini.
      </CenterState>
    );
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <div className="flex-1">{children}</div>
      {nav && <ManagerNav />}
    </div>
  );
}
