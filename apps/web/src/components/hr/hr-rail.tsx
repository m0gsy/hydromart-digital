'use client';

import { useT } from '@/lib/locale-context';

import {
  Buildings,
  CalendarCheck,
  ChartBar,
  ClipboardText,
  Clock,
  CurrencyCircleDollar,
  Gauge,
  GearSix,
  Megaphone,
  Package,
  Sparkle,
  Star,
  Storefront,
  UserCircle,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ConsoleSignOut } from '@/components/console-sign-out';
import { useAuth } from '@/lib/auth-context';
import { hrNavItems, type HrHref } from '@/lib/hr-nav';
import { normalisePath } from '@/lib/screen-chrome';

/**
 * The rail's icons, one per row of `lib/hr-nav.ts` (and its /hq door). Here rather than in that
 * table so that `canOpenRoute`, which reads the table, does not bundle them; keyed by the
 * table's own hrefs, so a row added there without an icon here does not build.
 */
export const HR_ICONS: Record<HrHref, Icon> = {
  '/hq': Buildings,
  '/hr': Gauge,
  '/hr/employees': Users,
  '/hr/departments': Buildings,
  '/hr/customers': Users,
  '/hr/resellers': Storefront,
  '/hr/attendance': CalendarCheck,
  '/hr/leave': CalendarCheck,
  '/hr/payroll': CurrencyCircleDollar,
  '/hr/adjustments': ClipboardText,
  '/hr/allowances': CurrencyCircleDollar,
  '/hr/loans': CurrencyCircleDollar,
  '/hr/depot-requests': Users,
  '/hr/assets': Package,
  '/hr/announcements': Megaphone,
  '/hr/rules': Sparkle,
  '/hr/performance': Star,
  '/hr/shift': Clock,
  '/hr/calendar': CalendarCheck,
  '/hr/reports': ChartBar,
  '/hr/settings': GearSix,
  '/hr/audit': ClipboardText,
  '/hr/me': UserCircle,
};

export function HrRail() {
  const { t } = useT();
  // The APK export runs with `trailingSlash: true`: a path with or without its final slash is one screen.
  const pathname = normalisePath(usePathname() ?? '');
  const { customer } = useAuth();
  /*
   * CA-2-17 — the way back out.
   *
   * This rail is nineteen HR screens and a sign-out button, and that was the whole of it:
   * every account that reached the HR console for any reason had two ways to leave, the
   * browser's back button and signing out. The ops rail has carried an `/hq` door for
   * exactly this reason since it was built; the HR rail never did, so a role whose console
   * is elsewhere — FINANCE reads HR payroll, and its landing used to drop it here — arrived
   * somewhere it could not leave. Same gate and same binary check as the ops rail's door,
   * because the Ops app prunes the whole `/hq` subtree.
   */
  const items = hrNavItems(customer?.role);

  return (
    <nav
      aria-label="HR"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-app px-3 py-6 sm:flex"
    >
      <p className="px-3 pb-2 text-xs font-bold uppercase tracking-wide text-muted">HR</p>
      {items.map(({ href, label }) => {
        const Icon = HR_ICONS[href];
        const active = href === '/hr' ? pathname === '/hr' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-brand-50 text-brand-800'
                : 'text-muted hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            <Icon size={20} weight={active ? 'fill' : 'regular'} />
            {t(label)}
          </Link>
        );
      })}
      <ConsoleSignOut />
    </nav>
  );
}
