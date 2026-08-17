'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { isSuperAdmin } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';

interface SettingDef {
  key: string;
  label: string;
  /** `^(a|b)$` — the server generates it from its own model registry. */
  pattern?: string;
}
interface SettingsSchema {
  defs: SettingDef[];
  effective: Record<string, string | number>;
}

/** The allowed values, read off the pattern the server sent — never a second list here. */
function optionsOf(def: SettingDef): string[] {
  const inner = /^\^\((.+)\)\$$/.exec(def.pattern ?? '')?.[1];
  return inner ? inner.split('|') : [];
}

/**
 * PR-J. A candidate forecast model is turned on for ONE depot, measured against the depot
 * next door, and turned off again — by whoever is watching the numbers. That is the whole
 * reason the model choice is a setting instead of an env var: with an env var every one of
 * those three steps is a release, and the person who can judge the numbers is not the
 * person with shell access.
 *
 * The values come from the server's own registry via the pattern on each def, so this
 * screen cannot offer a model the service would refuse to resolve.
 */
export default function ForecastModelsPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const superAdmin = isSuperAdmin(customer?.role);
  const [scope, setScope] = useState<'GLOBAL' | 'DEPOT'>('GLOBAL');
  const [depotId, setDepotId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const effDepot = scope === 'DEPOT' && depotId ? depotId : undefined;
  const { data, error, loading, reload } = useAsync<SettingsSchema>(
    () => api.get<SettingsSchema>(endpoints.forecastSettings.schema(effDepot), true),
    [effDepot],
  );

  // A value typed in one scope does not belong to the next one — the same trap the HR
  // settings screen already carries a comment about.
  useEffect(() => {
    setDrafts({});
  }, [scope, depotId]);

  async function save(key: string) {
    const value = drafts[key];
    if (value === undefined) {
      toast(t('hq.forecastModels.noChange'), 'error');
      return;
    }
    if (scope === 'DEPOT' && !depotId) {
      toast(t('hq.forecastModels.needDepot'), 'error');
      return;
    }
    try {
      await api.put(
        endpoints.forecastSettings.put,
        { scope, depotId: scope === 'DEPOT' ? depotId : undefined, key, value },
        true,
      );
      toast(t('hq.forecastModels.saved'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hq.forecastModels.saveFailed'), 'error');
    }
  }

  async function reset(key: string) {
    try {
      await api.del(
        endpoints.forecastSettings.reset,
        { scope, depotId: scope === 'DEPOT' ? depotId : undefined, key },
        true,
      );
      toast(t('hq.forecastModels.reverted'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hq.forecastModels.saveFailed'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader
        title={t('hq.forecastModels.title')}
        subtitle={t('hq.forecastModels.subtitle')}
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          {t('hq.forecastModels.scope')}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'DEPOT')}
            className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
          >
            <option value="GLOBAL">GLOBAL</option>
            <option value="DEPOT">DEPOT</option>
          </select>
        </label>
        {scope === 'DEPOT' && (
          <label className="text-sm">
            {t('hq.forecastModels.depotId')}
            <input
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
              className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
            />
          </label>
        )}
      </Card>

      {scope === 'GLOBAL' && !superAdmin && (
        <p className="text-sm text-amber-600">{t('hq.forecastModels.globalOnly')}</p>
      )}

      {loading && <Skeleton className="h-40" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.defs.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{d.label}</p>
                <p className="text-xs text-muted">
                  {t('hq.forecastModels.effective')}: {String(data.effective[d.key] ?? '—')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={drafts[d.key] ?? String(data.effective[d.key] ?? '')}
                  onChange={(e) => setDrafts((p) => ({ ...p, [d.key]: e.target.value }))}
                  className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
                >
                  {optionsOf(d).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => save(d.key)}>
                  {t('hq.forecastModels.save')}
                </Button>
                <Button variant="ghost" onClick={() => reset(d.key)}>
                  {t('hq.forecastModels.reset')}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-muted">{t('hq.forecastModels.measureFirst')}</p>
    </div>
  );
}
