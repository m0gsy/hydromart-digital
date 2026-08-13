'use client';

import { useState } from 'react';
import { Timer } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { SlaPolicy } from '@/lib/types';

/**
 * Design 19d — SLA policy editor.
 *
 * There were TWO thresholds. This screen wrote `onTimeThresholdMinutes` to admin-service
 * while delivery-service graded every delivery against its own `slaMinutes` setting — so
 * the number HQ edited changed nothing, and the number that decided courier commission was
 * only reachable from the depot settings screen.
 *
 * The threshold shown and saved here is now delivery-service's GLOBAL `slaMinutes`, the one
 * `onTime` is actually computed against. The healthy/critical bands stay in admin: they
 * colour HQ dashboards and delivery-service has no use for them. A depot may still override
 * the threshold for itself — this edits the value every depot falls back to.
 */
export default function HqSlaPolicyPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<SlaPolicy>(() => api.get(endpoints.admin.slaPolicy, true));
  const effective = useAsync<{ effective: Record<string, number | string> }>(() =>
    api.get(endpoints.deliverySettings.schema(), true),
  );
  const [draft, setDraft] = useState<SlaPolicy | null>(null);
  const [busy, setBusy] = useState(false);

  if (query.loading || effective.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error) return <ErrorState message={t('hq.slaPolicy.loadError')} onRetry={query.reload} />;
  if (effective.error) {
    return <ErrorState message={t('hq.slaPolicy.loadError')} onRetry={effective.reload} />;
  }

  // The effective threshold is delivery-service's, not admin's — admin's copy is what was
  // wrong. Falling back to it only when delivery has no value keeps the field populated.
  const liveSla = Number(effective.data?.effective?.slaMinutes);
  const stored = query.data!;
  const policy =
    draft ??
    (Number.isFinite(liveSla) ? { ...stored, onTimeThresholdMinutes: liveSla } : stored);
  const set = (patch: Partial<SlaPolicy>) => setDraft({ ...policy, ...patch });

  async function save() {
    setBusy(true);
    try {
      // The behaviour-changing write goes FIRST. If it is refused there is nothing to
      // celebrate, and saving the bands anyway would leave the screen showing a threshold
      // that never took — exactly the split this change exists to close. Global settings
      // are SUPER_ADMIN-only (`settingsGlobal`), so a 403 here is a real answer to report.
      await api.put(
        endpoints.deliverySettings.put,
        { scope: 'GLOBAL', key: 'slaMinutes', value: policy.onTimeThresholdMinutes },
        true,
      );
      const saved = await api.put<SlaPolicy>(
        endpoints.admin.slaPolicy,
        {
          onTimeThresholdMinutes: policy.onTimeThresholdMinutes,
          healthyBandPct: policy.healthyBandPct,
          criticalBandPct: policy.criticalBandPct,
        },
        true,
      );
      setDraft(saved);
      effective.reload();
      toast(t('hq.slaPolicy.saved'), 'success');
    } catch (err) {
      const forbidden = err instanceof ApiError && err.status === 403;
      toast(
        forbidden
          ? t('hq.slaPolicy.globalForbidden')
          : err instanceof ApiError
            ? err.message
            : t('hq.slaPolicy.saveError'),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Timer} title={t('hq.slaPolicy.title')} subtitle={t('hq.slaPolicy.subtitle')} />

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="sla" className="text-sm font-semibold">
              {t('hq.slaPolicy.threshold')}
            </label>
            <span className="text-lg font-extrabold tabular-nums text-brand-700">
              {t('hq.slaPolicy.minutes', { n: policy.onTimeThresholdMinutes })}
            </span>
          </div>
          <input
            id="sla"
            type="range"
            min={30}
            max={180}
            step={5}
            value={policy.onTimeThresholdMinutes}
            onChange={(e) => set({ onTimeThresholdMinutes: Number(e.target.value) })}
            className="mt-3 w-full accent-brand-600"
          />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{t('hq.slaPolicy.minutes', { n: 30 })}</span>
            <span>{t('hq.slaPolicy.minutes', { n: 180 })}</span>
          </div>
          <p className="mt-2 text-xs text-muted">{t('hq.slaPolicy.thresholdHint')}</p>
          <p className="mt-1 text-xs text-muted">{t('hq.slaPolicy.thresholdNote')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-app bg-[color:var(--success-bg)] p-4">
            <label htmlFor="healthy" className="text-xs font-bold uppercase tracking-wide text-[color:var(--success)]">
              {t('hq.slaPolicy.healthy')}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="healthy"
                type="number"
                min={0}
                max={100}
                value={policy.healthyBandPct}
                onChange={(e) => set({ healthyBandPct: Number(e.target.value) })}
                className="surface-elevated w-20 rounded-lg border border-app px-2.5 py-1.5 text-sm font-semibold tabular-nums focus:outline focus:outline-2 focus:outline-brand-600"
              />
              <span className="text-sm text-muted">{t('hq.slaPolicy.pctOnTime')}</span>
            </div>
          </div>
          <div className="rounded-xl border border-app bg-[color:var(--danger-bg)] p-4">
            <label htmlFor="critical" className="text-xs font-bold uppercase tracking-wide text-[color:var(--danger)]">
              {t('hq.slaPolicy.critical')}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="critical"
                type="number"
                min={0}
                max={100}
                value={policy.criticalBandPct}
                onChange={(e) => set({ criticalBandPct: Number(e.target.value) })}
                className="surface-elevated w-20 rounded-lg border border-app px-2.5 py-1.5 text-sm font-semibold tabular-nums focus:outline focus:outline-2 focus:outline-brand-600"
              />
              <span className="text-sm text-muted">{t('hq.slaPolicy.pctOnTime')}</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted">{t('hq.slaPolicy.deliveryNote')}</p>

        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>{t('hq.slaPolicy.save')}</Button>
        </div>
      </Card>
    </div>
  );
}
