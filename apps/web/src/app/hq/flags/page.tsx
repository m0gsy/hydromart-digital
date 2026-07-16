'use client';

import { useState } from 'react';
import { Flag } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { FEATURE_FLAGS_STUB, PLATFORM_SETTINGS_STUB, type FeatureFlagRow, type FlagState } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 8b — feature flags + platform settings. No config service, so toggling a flag
// is local state + a toast.
const STATES: FlagState[] = ['ROLLOUT', 'AKTIF', 'BETA', 'MATI'];

const STATE_STYLE: Record<FlagState, string> = {
  ROLLOUT: 'bg-brand-600 text-on-brand',
  AKTIF: 'bg-[color:var(--success-bg)] text-[color:var(--success)]',
  BETA: 'bg-[color:var(--warning-bg)] text-[color:var(--warning)]',
  MATI: 'bg-[color:var(--surface-soft)] text-muted',
};

export default function HqFlagsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [flags, setFlags] = useState<FeatureFlagRow[]>(FEATURE_FLAGS_STUB);

  function setState(row: FeatureFlagRow, state: FlagState) {
    // STUB: no feature-flag service — Milestone D. Local state + toast only.
    setFlags((prev) => prev.map((f) => (f.id === row.id ? { ...f, state } : f)));
    toast(t('hq.flags.changed', { name: row.name, state: t(`hq.flags.states.${state}`) }), 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Flag} title={t('hq.flags.title')} subtitle={t('hq.flags.subtitle')} stub />

      <div className="flex flex-col gap-3">
        {flags.map((f) => (
          <Card key={f.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{f.name}</p>
              <p className="text-xs text-muted">{f.desc}</p>
            </div>
            <div className="flex overflow-hidden rounded-full border border-app text-[11px] font-bold">
              {STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState(f, s)}
                  aria-pressed={f.state === s}
                  className={`px-2.5 py-1 transition-colors ${
                    f.state === s ? STATE_STYLE[s] : 'text-muted hover:bg-[color:var(--surface-soft)]'
                  }`}
                >
                  {t(`hq.flags.states.${s}`)}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-1 p-5">
        <p className="mb-2 text-sm font-extrabold">{t('hq.flags.platformTitle')}</p>
        {PLATFORM_SETTINGS_STUB.map((s) => (
          <div key={s.id} className="flex items-center justify-between border-b border-[color:var(--border-soft)] py-2.5 last:border-0">
            <span className="text-sm text-muted">{s.label}</span>
            <span className="text-sm font-semibold tabular-nums">{s.value}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
