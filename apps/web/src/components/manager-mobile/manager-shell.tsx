'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChartBar, Gavel, House, User } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
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
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-bold ${
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
 * Which depot this console is reading — and the way to change it.
 *
 * A manager covers a SET of depots (the supervision chain), and this console had no way to
 * say which one: every screen took `scopedId`, which is the first depot in the set, so an
 * approval queue or a team roster for the second depot was unreachable from a phone. The
 * desktop rail has had a switcher since B2; this is the same choice in the space a phone has.
 *
 * Hidden at one depot: with nothing to choose, a picker is a control that cannot do
 * anything. Native `<select>` on purpose — the phone's own wheel is the accessible one.
 */
function DepotBar() {
  const { t } = useT();
  const { depots, scopedId, setSelected } = useDepot();
  if (depots.length < 2) return null;
  return (
    <label className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
        {t('mgrFix.mMgr.depotPicker')}
      </span>
      <select
        value={scopedId ?? ''}
        onChange={(e) => setSelected(e.target.value)}
        className="min-h-11 min-w-0 flex-1 bg-transparent text-right text-[12.5px] font-extrabold text-brand-700"
      >
        {depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
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
      {nav && <DepotBar />}
      <div className="flex-1">{children}</div>
      {nav && <ManagerNav />}
    </div>
  );
}
