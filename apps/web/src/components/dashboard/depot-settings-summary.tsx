'use client';

import {
  Clock,
  GearSix,
  MapPinArea,
  Money as MoneyIcon,
  Motorcycle,
  Warning,
} from '@phosphor-icons/react';

import { Card, ErrorState, LoadError, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import { fetchSettingsSchema, type SettingsSchema } from '@/lib/settings';
import type { DepotAdmin } from '@/lib/types';

/**
 * Flow PR-3d: the read view that was /dashboard/depot-settings, now the read mode of the
 * settings page it duplicated (same gate, canManageDepots): the four figures a manager checks.
 */
function firstHours(d: DepotAdmin): string | null {
  const hours = d.operatingHours;
  if (!hours) return null;
  const first = Object.values(hours)[0];
  return first ? `${first.open}–${first.close}` : null;
}

function Row({
  icon,
  label,
  hint,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: string;
}) {
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

export function DepotSettingsSummary() {
  const { t } = useT();
  const { scopedId, selected } = useDepot();
  // WEBC-2: one record, the selected depot's — not the first hundred of the network to pick it out of.
  const list = useAsync<DepotAdmin | null>(
    () =>
      scopedId
        ? api.getCached<DepotAdmin>(endpoints.depots.manageDetail(scopedId), true)
        : Promise.resolve(null),
    [scopedId],
  );
  const depotCfg = useAsync<SettingsSchema>(
    () => fetchSettingsSchema('/depots/api/v1', scopedId ?? null),
    [scopedId],
  );
  const deliveryCfg = useAsync<SettingsSchema>(
    () => fetchSettingsSchema('/deliveries/api/v1', scopedId ?? null),
    [scopedId],
  );

  const depot = list.data ?? null;
  const depotName = selected?.name ?? depot?.name ?? t('opsFix.common.depot');
  const hours = depot ? firstHours(depot) : null;
  const num = (s: SettingsSchema | null | undefined, key: string): number | null => {
    const v = s?.effective[key];
    return typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))
        ? Number(v)
        : null;
  };
  const deposit = num(depotCfg.data, 'gallonDepositIdr');
  const maxActive = num(deliveryCfg.data, 'maxActiveDeliveriesPerDriver');

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <GearSix size={20} weight="fill" className="text-brand-500" />
        <div>
          <h2 className="text-lg font-bold">{t('mgrFix.depotSettings.title')}</h2>
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
            value={
              depot
                ? t('mgrFix.depotSettings.km', { n: depot.serviceRadiusKm })
                : t('mgrFix.depotSettings.unset')
            }
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
            value={
              deposit != null
                ? `Rp ${deposit.toLocaleString('id-ID')}`
                : t('mgrFix.depotSettings.unread')
            }
          />
          <Row
            icon={<Motorcycle size={20} weight="fill" />}
            label={t('mgrFix.depotSettings.concurrency')}
            hint={t('mgrFix.depotSettings.concurrencyHint')}
            value={maxActive != null ? String(maxActive) : t('mgrFix.depotSettings.unread')}
          />
          {(depotCfg.error || deliveryCfg.error) && (
            <LoadError
              onRetry={() => {
                depotCfg.reload();
                deliveryCfg.reload();
              }}
            />
          )}
          <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            <Warning size={15} weight="fill" className="shrink-0" />
            {t('mgrFix.depotSettings.note')}
          </p>
        </div>
      )}
    </section>
  );
}
