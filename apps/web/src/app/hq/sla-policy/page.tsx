'use client';

import { useState } from 'react';
import { Timer } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { SLA_CRITICAL_BAND, SLA_DEFAULT_MINUTES, SLA_HEALTHY_BAND } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 19d — SLA policy editor. No policy endpoint, so the threshold + bands are local
// state; save just toasts.
export default function HqSlaPolicyPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [minutes, setMinutes] = useState(SLA_DEFAULT_MINUTES);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Timer} title={t('hq.slaPolicy.title')} subtitle={t('hq.slaPolicy.subtitle')} stub />

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="sla" className="text-sm font-semibold">
              {t('hq.slaPolicy.threshold')}
            </label>
            <span className="text-lg font-extrabold tabular-nums text-brand-700">
              {t('hq.slaPolicy.minutes', { n: minutes })}
            </span>
          </div>
          <input
            id="sla"
            type="range"
            min={30}
            max={180}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-3 w-full accent-brand-600"
          />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{t('hq.slaPolicy.minutes', { n: 30 })}</span>
            <span>{t('hq.slaPolicy.minutes', { n: 180 })}</span>
          </div>
          <p className="mt-2 text-xs text-muted">{t('hq.slaPolicy.thresholdHint')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-app bg-[color:var(--success-bg)] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--success)]">
              {t('hq.slaPolicy.healthy')}
            </p>
            <p className="mt-1 text-sm font-semibold">{t('hq.slaPolicy.band', { n: SLA_HEALTHY_BAND })}</p>
          </div>
          <div className="rounded-xl border border-app bg-[color:var(--danger-bg)] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--danger)]">
              {t('hq.slaPolicy.critical')}
            </p>
            <p className="mt-1 text-sm font-semibold">{t('hq.slaPolicy.criticalBand', { n: SLA_CRITICAL_BAND })}</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => toast(t('hq.slaPolicy.saved'), 'success')}>{t('hq.slaPolicy.save')}</Button>
        </div>
      </Card>
    </div>
  );
}
