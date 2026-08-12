'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
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

import { DepotSwitcher, GROUPS } from '@/components/dashboard/ops-rail';
import { Sheet } from '@/components/overlay';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
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
      className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-around border-t border-app bg-[color:var(--surface)]/95 px-2 pb-[max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-2.5 backdrop-blur-[8px] lg:hidden"
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
      {/* B2. This was a `<span>`: styled exactly like the four real tabs beside it, and
          doing nothing. The comment said "full menu is the desktop rail" — which meant a
          depot manager on a phone could reach four screens and no others, and could not
          re-scope the console to another depot at all. */}
      <MoreSheetTab />
    </nav>
  );
}

/**
 * The rest of the console, on a phone.
 *
 * Renders `GROUPS` from `ops-rail` rather than its own copy: one list, two surfaces. A
 * second copy would drift the first time a route is added to one and not the other, and
 * the symptom would be a screen that exists on desktop and is simply unreachable on a
 * phone — which is the defect this replaces.
 */
function MoreSheetTab() {
  const { customer } = useAuth();
  const { t } = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const role = customer?.role;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex flex-col items-center gap-[3px] text-[10px] font-bold text-[color:var(--text-muted)]"
      >
        <DotsThreeOutline size={21} />
        Lainnya
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('ops.more.title')}>
        <div className="flex flex-col gap-1 pb-2">
          {/* A depot-scoped console whose switcher only exists on desktop is a console a
              depot manager cannot re-scope from the floor. */}
          <div className="pb-2">
            <DepotSwitcher />
          </div>
          {GROUPS.map((group) => {
            const items = group.items.filter((i) => i.show(role));
            if (items.length === 0) return null;
            return (
              <div key={group.headKey}>
                <p className="px-1 pb-1 pt-3 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                  {t(`ops.groups.${group.headKey}`)}
                </p>
                {items.map((item) => {
                  const Ic = item.icon;
                  const on = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={
                        'flex items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-[14px] transition-colors ' +
                        (on ? 'bg-brand-50 font-extrabold text-brand-800' : 'text-[color:var(--text)]')
                      }
                    >
                      <Ic size={19} weight={on ? 'fill' : 'regular'} />
                      {t(`ops.nav.${item.labelKey}`)}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
