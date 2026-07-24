'use client';

import {
  CalendarCheck,
  ChartBar,
  ClipboardText,
  CurrencyCircleDollar,
  Gauge,
  GearSix,
  Star,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import { canManageHr } from '@/lib/roles';

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  adminOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/hr', label: 'Dashboard', icon: Gauge },
  { href: '/hr/employees', label: 'Karyawan', icon: Users },
  { href: '/hr/attendance', label: 'Absensi', icon: CalendarCheck },
  { href: '/hr/payroll', label: 'Payroll', icon: CurrencyCircleDollar },
  { href: '/hr/adjustments', label: 'Bonus & Potongan', icon: ClipboardText },
  { href: '/hr/performance', label: 'Kinerja', icon: Star },
  { href: '/hr/reports', label: 'Laporan', icon: ChartBar },
  { href: '/hr/settings', label: 'Konfigurasi Gaji', icon: GearSix, adminOnly: true },
  { href: '/hr/audit', label: 'Log Audit', icon: ClipboardText, adminOnly: true },
];

export function HrRail() {
  const pathname = usePathname();
  const { customer } = useAuth();
  const isAdmin = canManageHr(customer?.role);
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav
      aria-label="HR"
      className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-app px-3 py-6 sm:flex"
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
              active ? 'bg-brand-50 text-brand-800' : 'text-muted hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            <Icon size={20} weight={active ? 'fill' : 'regular'} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
