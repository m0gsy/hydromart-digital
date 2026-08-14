'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClockCounterClockwise, ListChecks, Truck, User, Wallet } from '@phosphor-icons/react';

import { OfflineQueueBanner } from '@/components/offline-queue-banner';
import { RequireAuth } from '@/components/require-auth';
import { CenterState, LinkButton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canUseCourierApp, consoleHome } from '@/lib/roles';

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
  // B1+E0. `env(safe-area-inset-bottom)` on its own reports 0 on any WebView older than
  // 140 — most of the courier fleet — so this nav sat directly on the gesture bar, and the
  // tab a courier taps a hundred times a shift was the one competing with a system swipe.
  // The Capacitor plugin always injects `--safe-area-inset-bottom`; `max()` keeps a real
  // 0.5rem floor when both are absent.
  return (
    <nav className="sticky bottom-0 flex border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-[max(0.5rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
      {tabs.map(({ href, labelKey, icon: Icon }) => {
        const active = href === '/driver' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-bold ${
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
 * Courier app frame: STAFF_DEPOT-only gate + bottom nav. Non-drivers get the 1k gate.
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
      {/* E0/PR-3. `layout.tsx` sets `viewportFit: 'cover'` app-wide, so the WebView draws
          under the status bar and the notch. The customer shell has paid for that since
          `app-bar.tsx:46`; these two phone shells never did, and their first row of
          content rendered underneath the clock. Guarded form on purpose: bare `env()`
          reports 0 on any WebView older than 140, which is most of the fleet. */}
      {canUseCourierApp(customer?.role) ? (
        <div className="mx-auto flex min-h-dvh max-w-[384px] flex-col pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]">
          {/* Anything captured without signal (shift check-in, proof of delivery) surfaces
              here on every driver screen until it reaches the server. */}
          <div className="px-5 pt-3 empty:hidden">
            <OfflineQueueBanner />
          </div>
          <div className="flex flex-1 flex-col">{children}</div>
          {nav && <DriverNav />}
        </div>
      ) : (
        <CenterState
          icon={<Truck size={32} />}
          title={t('driver.shell.gateTitle')}
          // The courier app has no top nav, so the refusal carries its own way out.
          action={
            <LinkButton href={consoleHome(customer?.role)} variant="secondary">
              {t('hq.denied.back')}
            </LinkButton>
          }
        >
          {t('driver.shell.gateBody')}
        </CenterState>
      )}
    </RequireAuth>
  );
}
