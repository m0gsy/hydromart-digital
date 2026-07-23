'use client';

import { useState } from 'react';
import {
  Bell,
  CaretRight,
  DeviceMobile,
  Gear,
  Key,
  Lock,
  Sun,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';

const ALERTS: { id: string; icon: Icon; def: boolean }[] = [
  { id: 'approval', icon: Bell, def: true },
  { id: 'lowStock', icon: WarningCircle, def: true },
  { id: 'dailySummary', icon: Sun, def: false },
];

function AccountBody() {
  const { locale, setLocale, t } = useT();
  // TODO persist via preferences
  const [alerts, setAlerts] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALERTS.map((a) => [a.id, a.def])),
  );

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gear size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashA.account.title')}</h1>
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          {t('dashA.account.alertsSection')}
        </p>
        <Card className="divide-y divide-app p-0">
          {ALERTS.map((a) => {
            const AIcon = a.icon;
            return (
              <div key={a.id} className="flex items-center gap-3 p-4">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <AIcon size={18} weight="fill" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{t(`dashA.account.alerts.${a.id}.label`)}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{t(`dashA.account.alerts.${a.id}.sub`)}</p>
                </div>
                <Toggle
                  on={alerts[a.id] ?? a.def}
                  onChange={(v) => setAlerts((prev) => ({ ...prev, [a.id]: v }))}
                  label={t(`dashA.account.alerts.${a.id}.label`)}
                />
              </div>
            );
          })}
        </Card>
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          {t('dashA.account.accountSection')}
        </p>
        <Card className="divide-y divide-app p-0">
          <div className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <DeviceMobile size={18} weight="fill" />
            </span>
            <span className="flex-1 text-sm font-semibold">{t('dashA.account.language')}</span>
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
          <StaticRow icon={Key} label={t('dashA.account.pin.label')} sub={t('dashA.account.pin.sub')} />
          <StaticRow icon={DeviceMobile} label={t('dashA.account.devices.label')} sub={t('dashA.account.devices.sub')} />
        </Card>
      </div>
    </div>
  );
}

function StaticRow({ icon: RIcon, label, sub }: { icon: Icon; label: string; sub: string }) {
  return (
    <button type="button" className="flex w-full items-center gap-3 p-4 text-left">
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <RIcon size={18} weight="fill" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[11px] text-[color:var(--text-muted)]">{sub}</p>
      </div>
      <CaretRight size={15} className="text-[color:var(--text-muted)]" />
    </button>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title={t('dashA.account.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.account.gateBody')}
      </CenterState>
    );
  }
  return <AccountBody />;
}

export default function AccountSettingsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
