'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';
import { Drop, Gauge, Info, Lock, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, FormError, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canRecordMeterReading, canViewMeterReading } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { MeterHistoryRow, MeterReconciliation } from '@/lib/types';
import { todayWib } from '@/lib/wib';

const TODAY = todayWib();

const num = (v: number | null | undefined, digits = 0): string =>
  v == null ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: digits });

/** A metric that is null because it is not knowable yet must read "—", never 0. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'danger' | 'plain';
}) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="text-xs text-[color:var(--text-muted)]">{label}</span>
      <span
        className={`text-3xl font-bold tabular-nums ${
          tone === 'danger' ? 'text-[color:var(--danger)]' : ''
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-[color:var(--text-muted)]">{hint}</span>
    </Card>
  );
}

/** Bare CSS bar chart — the variance history does not warrant a charting library. */
function VarianceChart({ rows }: { rows: MeterHistoryRow[] }) {
  const { t } = useT();
  const withVariance = rows.filter((r) => r.varianceLiters != null);
  if (withVariance.length === 0) {
    return (
      <p className="py-3 text-sm text-[color:var(--text-muted)]">
        {t('hrFix.meter.noClosedDays')}
      </p>
    );
  }
  const peak = Math.max(...withVariance.map((r) => Math.abs(r.varianceLiters!)), 1);
  return (
    <ul className="flex flex-col gap-2">
      {withVariance.map((r) => {
        const v = r.varianceLiters!;
        return (
          <li key={r.day} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs tabular-nums text-[color:var(--text-muted)]">
              {r.day.slice(5)}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--border)]">
              <div
                className={`h-full rounded-full ${v < 0 ? 'bg-[color:var(--danger)]' : 'bg-brand-500'}`}
                style={{ width: `${(Math.abs(v) / peak) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums">
              {v > 0 ? '+' : ''}
              {num(v)} L
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MeterBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? depots[0] ?? null;
  const writable = canRecordMeterReading(customer?.role);

  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [sourceOpening, setSourceOpening] = useState('');
  const [sourceClosing, setSourceClosing] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const day = useAsync<MeterReconciliation | null>(
    () => (depot ? api.get(endpoints.reports.meterDay(depot.id, TODAY), true) : Promise.resolve(null)),
    [depot?.id],
  );
  const history = useAsync<MeterHistoryRow[]>(
    () => (depot ? api.get(endpoints.reports.meterHistory(depot.id), true) : Promise.resolve([])),
    [depot?.id],
  );

  const data = day.data;
  const reading = data?.reading ?? null;

  async function save(fields: Record<string, number>) {
    if (!depot) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(endpoints.reports.meterSave(depot.id, TODAY), fields, true);
      setOpening('');
      setClosing('');
      setSourceOpening('');
      setSourceClosing('');
      day.reload();
      history.reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('hrFix.meter.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const parsed = (v: string): number | null => {
    const n = Number(v.replace(',', '.'));
    return v.trim() === '' || Number.isNaN(n) ? null : n;
  };

  const openingValue = parsed(opening);
  const closingValue = parsed(closing);
  const sourceOpeningValue = parsed(sourceOpening);
  const sourceClosingValue = parsed(sourceClosing);
  const nothingToSave =
    openingValue === null &&
    closingValue === null &&
    sourceOpeningValue === null &&
    sourceClosingValue === null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gauge size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hrFix.meter.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {depot?.name ?? t('hrFix.meter.pickDepot')} · {TODAY}
          </p>
        </div>
      </div>

      {writable && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-semibold">{t('hrFix.meter.record')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">{t('hrFix.meter.morning')}</span>
              <Input
                inputMode="decimal"
                placeholder={reading ? String(reading.openingM3) : '1245.320'}
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">{t('hrFix.meter.evening')}</span>
              <Input
                inputMode="decimal"
                placeholder={reading?.closingM3 != null ? String(reading.closingM3) : '1247.920'}
                value={closing}
                onChange={(e) => setClosing(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">{t('hrFix.meter.rawMorning')}</span>
              <Input
                inputMode="decimal"
                value={sourceOpening}
                onChange={(e) => setSourceOpening(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">{t('hrFix.meter.rawEvening')}</span>
              <Input
                inputMode="decimal"
                value={sourceClosing}
                onChange={(e) => setSourceClosing(e.target.value)}
              />
            </label>
          </div>
          <FormError message={saveError} />
          <Button
            disabled={saving || nothingToSave || !depot}
            onClick={() =>
              save({
                ...(openingValue !== null ? { openingM3: openingValue } : {}),
                ...(closingValue !== null ? { closingM3: closingValue } : {}),
                ...(sourceOpeningValue !== null ? { sourceOpeningM3: sourceOpeningValue } : {}),
                ...(sourceClosingValue !== null ? { sourceClosingM3: sourceClosingValue } : {}),
              })
            }
          >
            {saving ? t('hrFix.meter.saving') : t('hrFix.meter.save')}
          </Button>
          <p className="text-xs text-[color:var(--text-muted)]">
            {t('hrFix.meter.twiceHint')}
          </p>
        </Card>
      )}

      {day.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : day.error ? (
        <ErrorState message={day.error} onRetry={day.reload} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label={t('hrFix.meter.waterOut')}
              value={data?.meterLiters != null ? `${num(data.meterLiters)} L` : '—'}
              hint={
                data?.meterLiters != null
                  ? `${num(reading?.openingM3, 3)} → ${num(reading?.closingM3, 3)} m³`
                  : 'meteran sore belum dicatat'
              }
            />
            <Stat
              label={t('hrFix.meter.waterSold')}
              value={`${num(data?.soldLiters)} L`}
              hint={t('opsFix.meter.deliveredHint', { n: num(data?.gallonsDelivered), amount: formatIDR(data?.revenueIdr ?? 0) })}
            />
            <Stat
              label={t('hrFix.meter.difference')}
              value={
                data?.varianceLiters != null
                  ? `${data.varianceLiters > 0 ? '+' : ''}${num(data.varianceLiters)} L`
                  : '—'
              }
              hint={
                data?.varianceGallons != null
                  ? t('hrFix.meter.varianceHint', {
                      gallons: num(Math.abs(data.varianceGallons), 1),
                      liters: num((data.referenceVolumeMl ?? 0) / 1000),
                    })
                  : 'belum bisa dibandingkan'
              }
              tone={data?.overTolerance ? 'danger' : 'plain'}
            />
            <Stat
              label={t('hrFix.meter.differenceValue')}
              value={data?.varianceIdr != null ? formatIDR(data.varianceIdr) : '—'}
              hint={
                data?.varianceIdr != null
                  ? t('opsFix.meter.perGallonHint')
                  : 'belum ada galon terkirim hari ini'
              }
              tone={data?.overTolerance ? 'danger' : 'plain'}
            />
          </div>

          {data?.roYieldPct != null && (
            <Card className="flex items-center justify-between p-5">
              <div>
                <p className="font-semibold">{t('hrFix.meter.roYield')}</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  air hasil dibanding air baku
                </p>
              </div>
              <span className="text-3xl font-bold tabular-nums">{num(data.roYieldPct, 1)}%</span>
            </Card>
          )}

          {data != null && data.unmeasuredLines > 0 && (
            <Card className="flex items-start gap-3 bg-brand-50 p-4">
              <Warning size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
              <p className="text-[12.5px] text-brand-800/80">
                <strong>{t('hrFix.meter.orderLines', { count: data.unmeasuredLines })}</strong>{t('hrFix.meter.noVolumeHint')}</p>
            </Card>
          )}

          {data?.overTolerance && (
            <Card className="flex items-start gap-3 border border-[color:var(--danger)] p-4">
              <Warning size={22} weight="fill" className="mt-0.5 shrink-0 text-[color:var(--danger)]" />
              <p className="text-[12.5px]">
                {t('hrFix.meter.overThreshold', { liters: num(data.toleranceLiters) })}
              </p>
            </Card>
          )}

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Drop size={18} weight="fill" className="text-brand-500" />
              {t('hrFix.meter.varianceHistory')}
            </h2>
            {history.loading ? (
              <Skeleton className="h-32 w-full" />
            ) : history.error ? (
              <ErrorState message={history.error} onRetry={history.reload} />
            ) : (
              <VarianceChart rows={history.data ?? []} />
            )}
          </Card>
        </>
      )}

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800/80">{t('hrFix.meter.sameDayHint')}</p>
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewMeterReading(customer?.role)) {
    return (
      <CenterState title={t('hrFix.meter.restricted')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.meter.gateBody2')}
      </CenterState>
    );
  }
  return <MeterBody />;
}

export default function MeterPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
