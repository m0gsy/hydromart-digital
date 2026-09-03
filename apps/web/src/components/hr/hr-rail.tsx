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
import { isServedHere } from '@/lib/deep-link';
import { canManageHr, isHq } from '@/lib/roles';

interface NavItem {
  href: string;
  /** Dictionary KEY — resolved where the item is rendered. */
  label: string;
  icon: Icon;
  adminOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/hr', label: 'hrFix.nav.dashboard', icon: Gauge },
  { href: '/hr/employees', label: 'hrFix.nav.employees', icon: Users },
  { href: '/hr/departments', label: 'hrFix.nav.departments', icon: Buildings },
  { href: '/hr/customers', label: 'hrFix.nav.customers', icon: Users },
  { href: '/hr/resellers', label: 'hrFix.nav.resellers', icon: Storefront },
  { href: '/hr/attendance', label: 'hrFix.nav.attendance', icon: CalendarCheck },
  { href: '/hr/leave', label: 'hrFix.nav.leave', icon: CalendarCheck },
  { href: '/hr/payroll', label: 'hrFix.nav.payroll', icon: CurrencyCircleDollar },
  { href: '/hr/adjustments', label: 'hrFix.nav.adjustments', icon: ClipboardText },
  { href: '/hr/allowances', label: 'hrFix.nav.allowances', icon: CurrencyCircleDollar },
  { href: '/hr/assets', label: 'hrFix.nav.assets', icon: Package },
  { href: '/hr/announcements', label: 'hrFix.nav.announcements', icon: Megaphone },
  { href: '/hr/rules', label: 'hrFix.nav.rules', icon: Sparkle, adminOnly: true },
  { href: '/hr/performance', label: 'hrFix.nav.performance', icon: Star },
  { href: '/hr/shift', label: 'hrFix.nav.shift', icon: Clock },
  { href: '/hr/calendar', label: 'hrFix.nav.calendar', icon: CalendarCheck },
  { href: '/hr/reports', label: 'hrFix.nav.reports', icon: ChartBar },
  { href: '/hr/settings', label: 'hrFix.nav.settings', icon: GearSix, adminOnly: true },
  { href: '/hr/audit', label: 'hrFix.nav.audit', icon: ClipboardText, adminOnly: true },
  /*
   * CA-1-36. HR staff are employees too — they punch in, take leave and are paid — and the
   * console they work in all day had no link to their own record. `/hr/me` was reachable
   * from the courier profile, the ops rail and the operator shell; the one rail belonging
   * to the people who run HR did not mention it. Last on purpose: it is the reader's own
   * business, not part of the queues above it.
   */
  { href: '/hr/me', label: 'hrFix.nav.me', icon: UserCircle },
];

export function HrRail() {
  const { t } = useT();
  const pathname = usePathname();
  const { customer } = useAuth();
  const isAdmin = canManageHr(customer?.role);
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
  const items = [
    ...(isHq(customer?.role) && isServedHere('/hq')
      ? [{ href: '/hq', label: 'hrFix.nav.hqConsole', icon: Buildings }]
      : []),
    ...ITEMS.filter((i) => !i.adminOnly || isAdmin),
  ];

  return (
    <nav
      aria-label="HR"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-app px-3 py-6 sm:flex"
    >
      <p className="px-3 pb-2 text-xs font-bold uppercase tracking-wide text-muted">HR</p>
      {items.map(({ href, label, icon: Icon }) => {
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
