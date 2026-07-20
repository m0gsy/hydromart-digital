'use client';

import { Clock, GearSix, Lock, MapPinArea, Money as MoneyIcon, Motorcycle, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canManageDepots } from '@/lib/roles';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page } from '@/lib/types';

// Spec 5b — read-only depot config: service radius, operating hours, gallon deposit,
// per-courier concurrency. Radius + hours are real (depot-service DepotAdmin). Deposit &
// concurrency are system constants surfaced for reference.
// ponytail: GALLON_DEPOSIT_IDR (50k) and the 1-order-per-courier cap live server-side as
// constants with no read endpoint; hard-coded here to match the enforced values. Wire to a
// depot-config GET when the deposit becomes per-depot editable.
const GALLON_DEPOSIT_IDR = 50000;

function firstHours(d: DepotAdmin): string | null {
  const hours = d.operatingHours;
  if (!hours) return null;
  const first = Object.values(hours)[0];
  return first ? `${first.open}–${first.close}` : null;
}

function Row({ icon, label, hint, value }: { icon: React.ReactNode; label: string; hint: string; value: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="text-brand-700">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </Card>
  );
}

function DepotSettingsBody() {
  const { t } = useT();
  const { scopedId, selected } = useDepot();
  const list = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true), []);

  const depot = list.data?.items.find((d) => d.id === scopedId) ?? null;
  const depotName = selected?.name ?? depot?.name ?? 'Depot';
  const hours = depot ? firstHours(depot) : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <GearSix size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('mgrFix.depotSettings.title')}</h1>
          <p className="text-sm text-muted">{depotName}</p>
        </div>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <div className="flex flex-col gap-3">
          <Row
            icon={<MapPinArea size={20} weight="fill" />}
            label={t('mgrFix.depotSettings.radius')}
            hint={t('mgrFix.depotSettings.radiusHint')}
            value={depot ? t('mgrFix.depotSettings.km', { n: depot.serviceRadiusKm }) : t('mgrFix.depotSettings.unset')}
          />
          <Row
            icon={<Clock size={20} weight="fill" />}
            label={t('mgrFix.depotSettings.hours')}
            hint={t('mgrFix.depotSettings.hoursHint')}
            value={hours ?? t('mgrFix.depotSettings.unset')}
          />
          <Row
            icon={<MoneyIcon size={20} weight="fill" />}
            label={t('mgrFix.depotSettings.deposit')}
            hint={t('mgrFix.depotSettings.depositHint')}
            value={`Rp ${GALLON_DEPOSIT_IDR.toLocaleString('id-ID')}`}
          />
          <Row
            icon={<Motorcycle size={20} weight="fill" />}
            label={t('mgrFix.depotSettings.concurrency')}
            hint={t('mgrFix.depotSettings.concurrencyHint')}
            value="1"
          />
          <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            <Warning size={15} weight="fill" className="shrink-0" />
            {t('mgrFix.depotSettings.note')}
          </p>
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageDepots(customer?.role)) {
    return (
      <CenterState title={t('mgrFix.depotSettings.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('mgrFix.depotSettings.gateBody')}
      </CenterState>
    );
  }
  return <DepotSettingsBody />;
}

export default function DepotSettingsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
