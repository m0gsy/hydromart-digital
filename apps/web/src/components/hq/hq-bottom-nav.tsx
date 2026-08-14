'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChartLineUp,
  ShieldCheck,
  Storefront,
  UserGear,
  type Icon,
} from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isHq } from '@/lib/roles';

interface Tab {
  href: string;
  labelKey: string;
  icon: Icon;
}

// Mobile HQ tab bar (design 24a). Desktop uses the left rail (lg-only). The four
// tabs are the Milestone-A ready routes; the whole console is isHq-gated by layout.
const TABS: Tab[] = [
  { href: '/hq', labelKey: 'overview', icon: ChartLineUp },
  { href: '/hq/depots', labelKey: 'depots', icon: Storefront },
  { href: '/hq/access', labelKey: 'access', icon: ShieldCheck },
  { href: '/hq/staff', labelKey: 'staff', icon: UserGear },
];

export function HqBottomNav() {
  const pathname = usePathname();
  const { customer } = useAuth();
  const { t } = useT();
  if (!isHq(customer?.role)) return null;

  const isActive = (href: string) =>
    href === '/hq' ? pathname === '/hq' : pathname.startsWith(href);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex max-w-[100vw] items-end justify-around overflow-hidden border-t border-app bg-[color:var(--surface)]/95 px-2 pb-[max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-2.5 backdrop-blur-[8px] lg:hidden"
      aria-label="Navigasi HQ"
    >
      {TABS.map((tab) => {
        const on = isActive(tab.href);
        const Ic = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            className={
              // `flex-1`: four labels sharing the bar means a 78px target each; content-width made
              // "Akses" a 35px one, tall enough and too narrow to hit.
              'flex min-h-11 flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-extrabold transition-colors ' +
              (on ? 'text-brand-600' : 'text-[color:var(--text-muted)]')
            }
          >
            <Ic size={21} weight={on ? 'fill' : 'regular'} />
            {t(`hq.bottomNav.${tab.labelKey}`)}
          </Link>
        );
      })}
    </nav>
  );
}
