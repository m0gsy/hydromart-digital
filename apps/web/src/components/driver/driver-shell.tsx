'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClockCounterClockwise, ListChecks, Truck, User } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

const TABS = [
  { href: '/driver', label: 'Tugas', icon: ListChecks },
  { href: '/driver/history', label: 'Riwayat', icon: ClockCounterClockwise },
  { href: '/driver/profile', label: 'Profil', icon: User },
] as const;

/** Bottom tab bar — 3 tabs per the courier design (not the ops OpsBottomNav). */
function DriverNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 flex border-t border-[color:var(--border)] bg-[color:var(--surface)] pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ href, label, icon: Icon }) => {
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
            {label}
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
  return (
    <RequireAuth>
      {customer?.role === 'DRIVER' ? (
        <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
          <div className="flex-1">{children}</div>
          {nav && <DriverNav />}
        </div>
      ) : (
        <CenterState icon={<Truck size={32} />} title="Halaman khusus kurir">
          Akun ini bukan kurir. Masuk dengan akun kurir untuk mengakses daftar pengantaran.
        </CenterState>
      )}
    </RequireAuth>
  );
}
