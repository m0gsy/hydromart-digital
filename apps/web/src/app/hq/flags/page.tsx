'use client';

import { useState } from 'react';
import { Flag } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { FeatureFlag, FlagState, SystemSettings } from '@/lib/types';

// Design 8b — feature flags + platform settings. Real admin-service track: flags load from
// GET /feature-flags and a state change PATCHes /feature-flags/:key; platform settings load
// from GET /system-settings (read-only here — editing is a later screen).
const STATES: FlagState[] = ['ROLLOUT', 'ACTIVE', 'BETA', 'OFF'];

const STATE_STYLE: Record<FlagState, string> = {
  ROLLOUT: 'bg-brand-600 text-on-brand',
  ACTIVE: 'bg-[color:var(--success-bg)] text-[color:var(--success)]',
  BETA: 'bg-[color:var(--warning-bg)] text-[color:var(--warning)]',
  OFF: 'bg-[color:var(--surface-soft)] text-muted',
};

export default function HqFlagsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const flagsQuery = useAsync<FeatureFlag[]>(() => api.get(endpoints.admin.flags, true));
  const settingsQuery = useAsync<SystemSettings>(() => api.get(endpoints.admin.settings, true));
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (flagsQuery.loading) return <Skeleton className="h-96 w-full" />;
  if (flagsQuery.error) return <ErrorState message={t('hq.flags.loadError')} onRetry={flagsQuery.reload} />;

  const rows = flags ?? flagsQuery.data!;

  async function setState(row: FeatureFlag, state: FlagState) {
    if (row.state === state) return;
    setBusyKey(row.key);
    // Optimistic: reflect immediately, roll back on failure.
    setFlags(rows.map((f) => (f.key === row.key ? { ...f, state } : f)));
    try {
      const saved = await api.patch<FeatureFlag>(endpoints.admin.flag(row.key), { state }, true);
      setFlags((prev) => (prev ?? rows).map((f) => (f.key === row.key ? saved : f)));
      toast(t('hq.flags.changed', { name: row.label, state: t(`hq.flags.states.${state}`) }), 'success');
    } catch (err) {
      setFlags(rows);
      toast(err instanceof ApiError ? err.message : t('hq.flags.saveError'), 'error');
    } finally {
      setBusyKey(null);
    }
  }

  const settings = settingsQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Flag} title={t('hq.flags.title')} subtitle={t('hq.flags.subtitle')} />

      <div className="flex flex-col gap-3">
        {rows.map((f) => (
          <Card key={f.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{f.label}</p>
              <p className="text-xs text-muted">{f.description}</p>
            </div>
            <div
              className="flex overflow-hidden rounded-full border border-app text-[11px] font-bold"
              aria-busy={busyKey === f.key}
            >
              {STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busyKey === f.key}
                  onClick={() => setState(f, s)}
                  aria-pressed={f.state === s}
                  className={`px-2.5 py-1 transition-colors disabled:opacity-60 ${
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
        {settingsQuery.loading && <Skeleton className="h-16 w-full" />}
        {settingsQuery.error && (
          <ErrorState message={t('hq.flags.loadError')} onRetry={settingsQuery.reload} />
        )}
        {settings && (
          <>
            <SettingRow label={t('hq.flags.tz')} value={settings.defaultTimezone} />
            <SettingRow label={t('hq.flags.currency')} value={settings.currency} />
            <SettingRow label={t('hq.flags.radius')} value={t('hq.flags.km', { n: settings.serviceRadiusKm })} />
          </>
        )}
      </Card>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[color:var(--border-soft)] py-2.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
