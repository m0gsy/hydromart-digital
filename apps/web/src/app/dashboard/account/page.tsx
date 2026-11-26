'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Buildings,
  CaretRight,
  DeviceMobile,
  Gear,
  Wrench,
  ClipboardText,
  Lock,
  ShieldCheck,
  ShoppingBag,
  SignOut,
  Sun,
  Truck,
  UserCircle,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';

import { DevicePushRow } from '@/components/dashboard/ops-push';
import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Chip, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import {
  canUseManagerConsole,
  canUseOperatorConsole,
  isDepotOperator,
  isStaff,
  staffDoor,
} from '@/lib/roles';
import { usePushPrefs } from '@/lib/notif-prefs';
import { useEffectiveCapabilities } from '@/lib/use-effective-capabilities';

/** `label` set: one of the operator's own alerts, named as /dashboard/operator-settings named it. */
type Alert = { id: string; icon: Icon; def: boolean; label?: string; email?: boolean };

const ALERTS: Alert[] = [
  { id: 'approval', icon: Bell, def: true },
  { id: 'lowStock', icon: WarningCircle, def: true },
  { id: 'dailySummary', icon: Sun, def: true },
];
// Flow PR-3d: the head of depot's alerts from the merged operator settings (low stock is
// already above).
const OPERATOR_ALERTS: Alert[] = [
  { id: 'newOrder', icon: ShoppingBag, def: true, label: 'dashB.operatorSettings.notifNewOrder' },
  { id: 'courierFail', icon: Truck, def: true, label: 'dashB.operatorSettings.notifCourierFail' },
];

// HD-15: the maintenance reminder n8n raises reaches everyone above the till in a depot, by push
// and by email, so those roles carry both switches here (the depot staff are never sent it).
const MAINTENANCE_ALERT: Alert = { id: 'maintenanceDue', icon: Wrench, def: true, email: true };

const VISIT_ALERT: Alert = { id: 'visitFinding', icon: ClipboardText, def: true, email: true };

function initials(name: string | null | undefined): string {
  if (!name) return '·';
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/*
 * Flow PR-3d: this is the one account screen of the depot console. /dashboard/profile (who
 * you are, your depot, your access, sign out) and /dashboard/operator-settings (the head of
 * depot's alerts and sign out) were merged in and redirect here. Compared line by line, what
 * did NOT come along: the operator screen's "Data akun" and "Ubah PIN" rows were buttons that
 * opened nothing (no PIN feature exists, as 1d found for this screen), and its "batas stok
 * rendah" chip printed a fixed dictionary string, not a setting.
 */
function AccountBody() {
  const router = useRouter();
  const { customer, signOut } = useAuth();
  const { selected, depots } = useDepot();
  const { locale, setLocale, t } = useT();
  const prefs = usePushPrefs();
  const caps = useEffectiveCapabilities();
  const role = customer?.role ?? '';
  const depot = selected ?? depots[0] ?? null;
  const assigned = canUseManagerConsole(role) || isDepotOperator(role);
  const base = canUseOperatorConsole(role) ? [...ALERTS, ...OPERATOR_ALERTS] : ALERTS;
  const alerts = role === 'STAFF_DEPOT' ? base : [...base, MAINTENANCE_ALERT, VISIT_ALERT];
  // The capability list was the manager's profile; it stays theirs.
  const myCaps = canUseManagerConsole(role)
    ? (Object.keys(caps) as (keyof typeof caps)[]).filter((cap) =>
        (caps[cap] as readonly string[]).includes(role),
      )
    : [];
  const roleLabel = t(`ops.roles.${role}`) === `ops.roles.${role}` ? role : t(`ops.roles.${role}`);

  const logout = () => {
    signOut();
    router.replace(staffDoor(window.location.pathname));
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gear size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashA.account.title')}</h1>
      </div>

      <Card className="flex items-center gap-3 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-700 text-base font-extrabold text-on-brand">
          {initials(customer?.fullName)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">{customer?.fullName ?? roleLabel}</p>
          <p className="truncate text-[12.5px] text-[color:var(--text-muted)]">
            {customer?.phone ?? ''} · {roleLabel}
          </p>
        </div>
      </Card>

      {/* Only a role that runs a depot has one assigned. For a network role the list is every
          depot, and its first one is not an assignment. */}
      {assigned && (
        <Card className="flex items-start gap-3 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Buildings size={22} weight="fill" />
          </span>
          <div>
            <p className="text-xs font-semibold text-[color:var(--text-muted)]">
              {t('dashC.profile.depotAssigned')}
            </p>
            <p className="mt-0.5 font-semibold">
              {depot ? `${depot.name} · ${depot.code}` : t('dashC.profile.noDepot')}
            </p>
          </div>
        </Card>
      )}

      {myCaps.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} weight="fill" className="text-brand-600" />
            <p className="font-semibold">{t('dashC.profile.access')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {myCaps.map((cap) => (
              <Chip key={cap} tone="tint">
                {cap}
              </Chip>
            ))}
          </div>
        </Card>
      )}

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          {t('dashA.account.alertsSection')}
        </p>
        <Card className="divide-y divide-app p-0">
          {alerts.map((a) => {
            const AIcon = a.icon;
            const label = t(a.label ?? `dashA.account.alerts.${a.id}.label`);
            return (
              <div key={a.id} className="flex items-center gap-3 p-4">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <AIcon size={18} weight="fill" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{label}</p>
                  {!a.label && (
                    <p className="text-[11px] text-[color:var(--text-muted)]">
                      {t(`dashA.account.alerts.${a.id}.sub`)}
                    </p>
                  )}
                </div>
                {a.email && (
                  <div className="flex flex-col items-center gap-1">
                    <Toggle
                      on={prefs.isOn(a.id, 'email') ?? a.def}
                      onChange={(v) => void prefs.setOn(a.id, v, label, 'email')}
                      label={`${label} (${t('dashA.account.channelEmail')})`}
                    />
                    <span className="text-[10px] text-[color:var(--text-muted)]">
                      {t('dashA.account.channelEmail')}
                    </span>
                  </div>
                )}
                <div className="flex flex-col items-center gap-1">
                  <Toggle
                    on={prefs.isOn(a.id) ?? a.def}
                    onChange={(v) => void prefs.setOn(a.id, v, label)}
                    label={a.email ? `${label} (${t('dashA.account.channelPush')})` : label}
                  />
                  {a.email && (
                    <span className="text-[10px] text-[color:var(--text-muted)]">
                      {t('dashA.account.channelPush')}
                    </span>
                  )}
                </div>
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
          {/* The operator screen named "Data akun" and opened nothing; it opens the profile editor now. */}
          <Link href="/account/edit" className="flex w-full items-center gap-3 p-4 text-left">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <UserCircle size={18} weight="fill" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">{t('dashB.operatorSettings.accountData')}</p>
              <p className="text-[11px] text-[color:var(--text-muted)]">
                {t('dashB.operatorSettings.accountDataSub')}
              </p>
            </div>
            <CaretRight size={15} className="text-[color:var(--text-muted)]" />
          </Link>
          <DevicePushRow />
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
                  className={`tap-44 min-h-11 px-3 py-1.5 uppercase ${
                    locale === l ? 'bg-brand-600 text-on-brand' : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {/* Signed-in devices live in /account's Perangkat sheet (sign out everywhere included);
              this row used to look like a door and open nothing. */}
          <Link
            href="/account?sheet=devices"
            className="flex w-full items-center gap-3 p-4 text-left"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <DeviceMobile size={18} weight="fill" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">{t('dashA.account.devices.label')}</p>
              <p className="text-[11px] text-[color:var(--text-muted)]">
                {t('dashA.account.devices.sub')}
              </p>
            </div>
            <CaretRight size={15} className="text-[color:var(--text-muted)]" />
          </Link>
        </Card>
      </div>

      {/* The way out both merged screens had (operator-settings:118 among them). */}
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
