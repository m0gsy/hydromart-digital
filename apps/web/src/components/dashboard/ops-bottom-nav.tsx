'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Buildings,
  ChartLineUp,
  ClipboardText,
  DotsThreeOutline,
  Package,
  Tag,
  TrendUp,
  type Icon,
} from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import {
  canManagePricing,
  canViewDashboard,
  canViewForecast,
  canViewFranchise,
  canViewInventory,
  isStaff,
} from '@/lib/roles';

type Role = string | null | undefined;
interface Tab {
  href: string;
  label: string;
  icon: Icon;
  show: (r: Role) => boolean;
}

// Mobile ops tab bar (design 5k-5p). The desktop left rail is lg-only, so on
// small screens this carries dashboard navigation. Role-filtered; capped at the
// first 4 the role can see so the bar never overflows.
const TABS: Tab[] = [
  { href: '/dashboard/franchise', label: 'Ringkasan', icon: Buildings, show: canViewFranchise },
  { href: '/dashboard', label: 'Ringkasan', icon: ChartLineUp, show: canViewDashboard },
  { href: '/dashboard/orders', label: 'Antrean', icon: ClipboardText, show: isStaff },
  { href: '/dashboard/inventory', label: 'Inventori', icon: Package, show: canViewInventory },
  { href: '/dashboard/forecast', label: 'Perkiraan', icon: TrendUp, show: canViewForecast },
  { href: '/dashboard/pricing', label: 'Harga', icon: Tag, show: canManagePricing },
];

export function OpsBottomNav() {
  const pathname = usePathname();
  const { customer } = useAuth();
  const role = customer?.role;

  const visible = TABS.filter((t) => t.show(role)).slice(0, 4);
  if (visible.length === 0) return null;

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-around border-t border-app bg-[color:var(--surface)]/95 px-2 pb-[max(16px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-[8px] lg:hidden"
      aria-label="Navigasi operasi"
    >
      {visible.map((t) => {
        const on = isActive(t.href);
        const Ic = t.icon;
        return (
          <Link
            key={t.href + t.label}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={
              'flex flex-col items-center gap-[3px] text-[10px] font-extrabold transition-colors ' +
              (on ? 'text-brand-600' : 'text-[color:var(--text-muted)]')
            }
          >
            <Ic size={21} weight={on ? 'fill' : 'regular'} />
            {t.label}
          </Link>
        );
      })}
      {/* Static "more" affordance — mirrors design 5k; full menu is the desktop rail. */}
      <span className="flex flex-col items-center gap-[3px] text-[10px] font-bold text-[color:var(--text-muted)]">
        <DotsThreeOutline size={21} />
        Lainnya
      </span>
    </nav>
  );
}
