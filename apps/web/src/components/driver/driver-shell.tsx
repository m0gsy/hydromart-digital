'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClockCounterClockwise, ListChecks, Truck, User, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';

const TABS = [
  { href: '/driver', labelKey: 'tabTasks', icon: ListChecks },
  { href: '/driver/history', labelKey: 'tabHistory', icon: ClockCounterClockwise },
  { href: '/driver/profile', labelKey: 'tabProfile', icon: User },
] as const;

// Wallet section (earnings/settlement/expenses) surfaces a 4th Dompet tab for quick return.
const WALLET_TAB = { href: '/driver/earnings', labelKey: 'tabWallet', icon: Wallet } as const;
const WALLET_ROUTES = ['/driver/earnings', '/driver/settlement', '/driver/expenses'];

/** Bottom tab bar — 3 tabs per the courier design (+ Dompet on wallet screens). */
function DriverNav() {
  const { t } = useT();
  const pathname = usePathname();
  const inWallet = WALLET_ROUTES.some((r) => pathname.startsWith(r));
  const tabs = inWallet ? [...TABS, WALLET_TAB] : TABS;
  return (
    <nav className="sticky bottom-0 flex border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-[env(safe-area-inset-bottom)]">
      {tabs.map(({ href, labelKey, icon: Icon }) => {
        const active = href === '/driver' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold ${
              active ? 'text-brand-700' : 'text-[color:var(--muted)]'
            }`}
          >
            <Icon size={22} weight={active ? 'fill' : 'regular'} />
            {t(`driver.shell.${labelKey}`)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Courier app frame: DRIVER-only gate + bottom nav. Non-drivers get the 1k gate.
 * `nav={false}` for full-bleed flows (check-in, PoD) that own the whole screen.
 */
export function DriverShell({
  children,
  nav = true,
}: {
  children: React.ReactNode;
  nav?: boolean;
}) {
  const { customer } = useAuth();
  const { t } = useT();
  return (
    <RequireAuth>
      {customer?.role === 'DRIVER' ? (
        <div className="mx-auto flex min-h-dvh max-w-[384px] flex-col">
          <div className="flex-1">{children}</div>
          {nav && <DriverNav />}
        </div>
      ) : (
        <CenterState icon={<Truck size={32} />} title={t('driver.shell.gateTitle')}>
          {t('driver.shell.gateBody')}
        </CenterState>
      )}
    </RequireAuth>
  );
}
