'use client';

import { useRouter } from 'next/navigation';
import { Buildings, Lock, ShieldCheck, SignOut } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, Chip, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { isDepotManager } from '@/lib/roles';
import { CAPABILITIES } from '@hydromart/access';

function initials(name: string | null): string {
  if (!name) return 'M';
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Capabilities the DEPOT_MANAGER role holds — read straight off the shared RBAC map
// so the chip list can never drift from what the Nest guards actually enforce.
const MANAGER_CAPS = (Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]).filter((cap) =>
  (CAPABILITIES[cap] as readonly string[]).includes('DEPOT_MANAGER'),
);

function ProfileBody() {
  const router = useRouter();
  const { customer, signOut } = useAuth();
  const { selected, depots } = useDepot();
  const { locale, setLocale, t } = useT();

  // The depot the manager runs — the switcher selection, else the first available.
  const depot = selected ?? depots[0] ?? null;

  const logout = () => {
    signOut();
    router.replace('/login');
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <Card elevated className="flex flex-col items-center gap-3 bg-brand-700 p-8 text-center text-on-brand">
        <span className="flex size-20 items-center justify-center rounded-full bg-white/15 text-2xl font-extrabold">
          {initials(customer?.fullName ?? null)}
        </span>
        <div>
          <h1 className="text-2xl font-bold">{customer?.fullName ?? t('dashC.profile.role')}</h1>
          <p className="mt-1 text-sm text-white/85">
            {customer?.phone ?? '+62…'} · {t('dashC.profile.role')}
          </p>
        </div>
      </Card>

      <Card className="flex items-start gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Buildings size={22} weight="fill" />
        </span>
        <div>
          <p className="text-xs font-semibold text-[color:var(--text-muted)]">{t('dashC.profile.depotAssigned')}</p>
          <p className="mt-0.5 font-semibold">
            {depot ? `${depot.name} · ${depot.code}` : t('dashC.profile.noDepot')}
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} weight="fill" className="text-brand-600" />
          <p className="font-semibold">{t('dashC.profile.access')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {MANAGER_CAPS.map((cap) => (
            <Chip key={cap} tone="tint">
              {cap}
            </Chip>
          ))}
        </div>
      </Card>

      <Card className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold">{t('dashC.profile.language')}</p>
          <p className="text-[12.5px] text-[color:var(--text-muted)]">{t('dashC.profile.languageHint')}</p>
        </div>
        <div className="flex rounded-full bg-[color:var(--surface-soft)] p-1" role="group" aria-label={t('dashC.profile.languageAria')}>
          {(['id', 'en'] as const).map((lng) => (
            <button
              key={lng}
              type="button"
              onClick={() => setLocale(lng)}
              aria-pressed={locale === lng}
              className={`rounded-full px-3.5 py-1 text-xs font-bold transition-colors ${
                locale === lng ? 'bg-brand-600 text-on-brand' : 'text-[color:var(--text-muted)]'
              }`}
            >
              {lng === 'id' ? 'ID' : 'EN'}
            </button>
          ))}
        </div>
      </Card>

      <Button variant="danger" onClick={logout} className="w-full">
        <SignOut size={17} />
        {t('dashC.profile.signOut')}
      </Button>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title={t('dashC.profile.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.profile.gateBody')}
      </CenterState>
    );
  }
  return <ProfileBody />;
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
