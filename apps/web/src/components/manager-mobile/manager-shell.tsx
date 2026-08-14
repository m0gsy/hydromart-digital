'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { usePathname } from 'next/navigation';
import { Bell, ChartBar, Gavel, House, User } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { canUseManagerConsole } from '@/lib/roles';

const TABS = [
  { href: '/m/manager', label: 'hrFix.mgrNav.home', icon: House },
  { href: '/m/manager/approvals', label: 'hrFix.mgrNav.approvals', icon: Gavel },
  { href: '/m/manager/notifications', label: 'hrFix.mgrNav.notifications', icon: Bell },
  { href: '/m/manager/team', label: 'hrFix.mgrNav.team', icon: ChartBar },
  { href: '/m/manager/account', label: 'hrFix.mgrNav.account', icon: User },
] as const;

/** Bottom tab bar — 5 tabs per the Depot Manager Mobile design (cells 1b–3a). */
function ManagerNav() {
  const { t } = useT();
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 flex border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-[max(0.5rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
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
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Depot-manager phone frame: MANAGER-only gate + bottom nav. Sign-in itself is
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
  const { t } = useT();
  const { customer } = useAuth();
  if (!canUseManagerConsole(customer?.role)) {
    return (
      <CenterState icon={<House size={32} />} title={t('hrFix.managerShell.managerOnly')}>
        {t('hrFix.managerShell.notManager')}
      </CenterState>
    );
  }
  // E0/PR-3. `layout.tsx` sets `viewportFit: 'cover'` app-wide, so the WebView draws under
  // the status bar and the notch. The customer shell has paid for that since
  // `app-bar.tsx:46`; this shell and the courier one never did, and their first row of
  // content rendered underneath the clock. Guarded form on purpose: bare `env()` reports 0
  // on any WebView older than 140, which is most of the fleet.
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]">
      <div className="flex-1">{children}</div>
      {nav && <ManagerNav />}
    </div>
  );
}
