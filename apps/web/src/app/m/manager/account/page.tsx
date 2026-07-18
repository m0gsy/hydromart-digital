'use client';

import { useRouter } from 'next/navigation';
import {
  Bell,
  CaretRight,
  ChartLineUp,
  ShoppingBag,
  SignOut,
  Translate,
  UsersThree,
} from '@phosphor-icons/react';

import { Card } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';

function initials(name: string | null): string {
  if (!name) return 'M';
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// "Buka di desktop" — deep links into the full ops console (desktop-only tools).
const DESKTOP_LINKS = [
  { href: '/dashboard/franchise', icon: ChartLineUp, label: 'Laporan L/R' },
  { href: '/dashboard/inventory', icon: ShoppingBag, label: 'Pesanan pembelian' },
  { href: '/dashboard/staff', icon: UsersThree, label: 'Kelola tim' },
] as const;

export default function ManagerAccountPage() {
  const router = useRouter();
  const { customer, signOut } = useAuth();
  const { selected, depots } = useDepot();
  const { locale, setLocale } = useT();

  const depotName =
    selected?.name ?? depots.find((d) => d.id === customer?.assignedDepotId)?.name ?? 'Depot kamu';

  const logout = () => {
    signOut();
    router.replace('/m/manager/login');
  };

  return (
    <div className="space-y-4 px-4 py-6">
      <h1 className="text-xl font-extrabold tracking-tight">Akun</h1>

      <Card className="flex items-center gap-4 p-5">
        <div className="flex size-14 items-center justify-center rounded-full bg-brand-700 text-lg font-extrabold text-white">
          {initials(customer?.fullName ?? null)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-lg font-extrabold tracking-tight">
            {customer?.fullName ?? 'Manajer'}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-[color:var(--text-muted)]">
            Manajer depot · {depotName}
          </div>
        </div>
      </Card>

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          Buka di desktop
        </p>
        <Card className="divide-y divide-[color:var(--border)] p-0">
          {DESKTOP_LINKS.map(({ href, icon: Icon, label }) => (
            <button
              key={href}
              type="button"
              onClick={() => router.push(href)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span className="flex size-8 items-center justify-center rounded-xl bg-black/5 text-brand-700">
                <Icon size={19} weight="fill" />
              </span>
              <span className="flex-1 text-sm font-medium">{label}</span>
              <CaretRight size={15} className="text-[color:var(--text-muted)]" />
            </button>
          ))}
        </Card>
      </div>

      <Card className="divide-y divide-[color:var(--border)] p-0">
        <div className="flex items-center gap-3 p-4">
          <span className="flex size-8 items-center justify-center rounded-xl bg-black/5 text-brand-700">
            <Translate size={19} weight="fill" />
          </span>
          <span className="flex-1 text-sm font-medium">Bahasa</span>
          <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
            {(['id', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={`px-3 py-1.5 uppercase ${
                  locale === l ? 'bg-brand-600 text-on-brand' : 'text-[color:var(--text-muted)]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/m/manager/notifications')}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <span className="flex size-8 items-center justify-center rounded-xl bg-black/5 text-brand-700">
            <Bell size={19} weight="fill" />
          </span>
          <span className="flex-1 text-sm font-medium">Notifikasi</span>
          <CaretRight size={15} className="text-[color:var(--text-muted)]" />
        </button>
      </Card>

      <button
        type="button"
        onClick={logout}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 p-3.5 text-sm font-extrabold text-red-600"
      >
        <SignOut size={17} />
        Keluar
      </button>
      <p className="text-center text-[11px] text-[color:var(--text-muted)]">
        Hydromart Manajer · v1.0.0
      </p>
    </div>
  );
}
