'use client';

import { useRouter } from 'next/navigation';
import { CaretRight, ChartBar, Coins, GearSix, Megaphone, Question, Receipt, SealCheck, SignOut, Storefront, Truck, Wallet, Warning } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT, type TVars } from '@/lib/locale-context';

// "Motor · B 1234 ABC", or "Belum diatur" when the courier has no vehicle on file.
function vehicleText(
  c: { vehicleType?: string | null; plateNumber?: string | null } | null,
  t: (key: string, vars?: TVars) => string,
): string {
  const known = c?.vehicleType === 'MOTOR' || c?.vehicleType === 'MOBIL';
  const type = c?.vehicleType ? (known ? t(`driver.profile.vehicle.${c.vehicleType}`) : c.vehicleType) : null;
  const parts = [type, c?.plateNumber].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('driver.profile.notSet');
}

function initials(name: string | null): string {
  if (!name) return 'K';
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Profile() {
  const router = useRouter();
  const { t } = useT();
  const { customer, signOut } = useAuth();

  const logout = () => {
    signOut();
    router.replace('/login');
  };

  return (
    <div className="space-y-4 px-4 py-6">
      <h1 className="text-lg font-extrabold tracking-tight">{t('driver.profile.title')}</h1>

      <Card className="flex flex-col items-center gap-3 p-5 text-center">
        <div className="flex size-18 items-center justify-center rounded-full bg-brand-700 text-2xl font-extrabold text-white">
          {initials(customer?.fullName ?? null)}
        </div>
        <div>
          <div className="text-lg font-extrabold tracking-tight">{customer?.fullName ?? t('driver.profile.fallbackName')}</div>
          <div className="mt-1 flex items-center justify-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 font-bold text-green-800">
              <SealCheck size={13} weight="fill" />
              {t('driver.profile.active')}
            </span>
          </div>
          <div className="mt-2 text-[11px] tabular-nums text-[color:var(--muted)]">{customer?.phone}</div>
        </div>
      </Card>

      <Card className="divide-y divide-[color:var(--border)] p-0">
        {customer?.role === 'DRIVER' && (
          <div className="flex w-full items-center gap-3 p-4">
            <span className="flex size-8 items-center justify-center rounded-xl bg-black/5 text-brand-700">
              <Truck size={19} weight="fill" />
            </span>
            <span className="flex-1 text-sm font-medium">{t('driver.profile.vehicle.label')}</span>
            <span className="text-sm text-[color:var(--muted)]">{vehicleText(customer, t)}</span>
          </div>
        )}
        {customer?.assignedDepotId && (
          <Row
            icon={<Storefront size={19} weight="fill" />}
            label={t('driver.profile.depotPlacement')}
            onClick={() => router.push('/driver/announcements')}
          />
        )}
        <Row
          icon={<ChartBar size={19} weight="fill" />}
          label={t('driver.profile.weeklyPerformance')}
          onClick={() => router.push('/driver/performance')}
        />
        <Row
          icon={<Coins size={19} weight="fill" />}
          label={t('driver.profile.earnings')}
          onClick={() => router.push('/driver/earnings')}
        />
        <Row
          icon={<Wallet size={19} weight="fill" />}
          label={t('driver.profile.codSettlement')}
          onClick={() => router.push('/driver/settlement')}
        />
        <Row
          icon={<Receipt size={19} weight="fill" />}
          label={t('driver.profile.expenseClaim')}
          onClick={() => router.push('/driver/expenses')}
        />
        <Row
          icon={<Megaphone size={19} weight="fill" />}
          label={t('driver.profile.announcements')}
          onClick={() => router.push('/driver/announcements')}
        />
        <Row
          icon={<Warning size={19} weight="fill" />}
          label={t('driver.profile.reportIncident')}
          onClick={() => router.push('/driver/incidents/new')}
        />
        <Row
          icon={<GearSix size={19} weight="fill" />}
          label={t('driver.profile.settings')}
          onClick={() => router.push('/driver/settings')}
        />
        <Row
          icon={<Question size={19} weight="fill" />}
          label={t('driver.profile.help')}
          onClick={() => router.push('/driver/help')}
        />
      </Card>

      <button
        type="button"
        onClick={logout}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 p-3.5 text-sm font-extrabold text-red-600"
      >
        <SignOut size={17} />
        {t('driver.profile.logout')}
      </button>
      <p className="text-center text-[11px] text-[color:var(--muted)]">{t('driver.profile.version')}</p>
    </div>
  );
}

function Row({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 p-4 text-left disabled:cursor-default">
      <span className="flex size-8 items-center justify-center rounded-xl bg-black/5 text-brand-700">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <CaretRight size={15} className="text-[color:var(--muted)]" />
    </button>
  );
}

export default function ProfilePage() {
  return (
    <DriverShell>
      <Profile />
    </DriverShell>
  );
}
