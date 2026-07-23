'use client';

import { useState } from 'react';
import { GearSix, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canManageDepots } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import {
  fetchSettingsSchema,
  putSetting,
  resetSetting,
  SETTINGS_SERVICES,
  type SettingDef,
} from '@/lib/settings';

function selectClass() {
  return 'w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium';
}

/** number|money -> number input (with min/max), string -> text input. */
function inputType(def: SettingDef): 'number' | 'text' {
  return def.type === 'string' ? 'text' : 'number';
}

/** "menit · 1–120", "IDR · min 0", or undefined when the def carries neither. */
function rangeHint(def: SettingDef): string | undefined {
  const range = def.min != null && def.max != null
    ? `${def.min}–${def.max}`
    : def.min != null
      ? `min ${def.min}`
      : def.max != null
        ? `max ${def.max}`
        : undefined;
  return [def.unit, range].filter(Boolean).join(' · ') || undefined;
}

function SettingRow({
  base,
  def,
  effective,
  scope,
  depotId,
  onSaved,
}: {
  base: string;
  def: SettingDef;
  effective: number | string;
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [value, setValue] = useState(String(effective));
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ponytail: the schema response has no explicit "overridden" flag — effective vs.
  // envDefault is the only signal the API gives us. Good enough to show/hide the
  // reset action; add a real flag server-side if a false positive ever bites.
  const hasOverride = String(effective) !== String(def.envDefault);

  async function save() {
    setBusy('save');
    setError(null);
    try {
      await putSetting(base, {
        scope,
        depotId: depotId ?? undefined,
        key: def.key,
        value,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('settings.saveError'));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    setError(null);
    try {
      await resetSetting(base, { scope, depotId: depotId ?? undefined, key: def.key });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('settings.resetError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <p className="font-semibold">{def.label}</p>
        <p className="text-xs text-muted">{t('settings.envDefault', { v: def.envDefault })}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <Field
            label={t('settings.value')}
            htmlFor={`setting-${def.key}`}
            hint={rangeHint(def)}
          >
            <Input
              id={`setting-${def.key}`}
              type={inputType(def)}
              min={def.min}
              max={def.max}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        </div>
        <Button onClick={save} loading={busy === 'save'} disabled={busy !== null}>
          {t('settings.save')}
        </Button>
        {hasOverride && (
          <Button variant="secondary" onClick={reset} loading={busy === 'reset'} disabled={busy !== null}>
            {t('settings.reset')}
          </Button>
        )}
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
    </Card>
  );
}

function ServiceSection({
  base,
  label,
  scope,
  depotId,
}: {
  base: string;
  label: string;
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
}) {
  const { t } = useT();
  const schema = useAsync(() => fetchSettingsSchema(base, scope === 'DEPOT' ? depotId : null), [base, scope, depotId]);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{label}</h2>
      {schema.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : schema.error ? (
        <ErrorState message={schema.error} onRetry={schema.reload} />
      ) : !schema.data || schema.data.defs.length === 0 ? (
        <CenterState title={t('settings.emptyTitle')}>{t('settings.emptyBody')}</CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {schema.data.defs.map((def) => (
            <SettingRow
              key={def.key}
              base={base}
              def={def}
              effective={schema.data!.effective[def.key] ?? def.envDefault}
              scope={scope}
              depotId={depotId}
              onSaved={schema.reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsBody() {
  const { t } = useT();
  const { depots } = useDepot();
  const [scope, setScope] = useState<'GLOBAL' | 'DEPOT'>('GLOBAL');
  const [depotId, setDepotId] = useState<string | null>(null);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <GearSix size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
          <p className="text-sm text-muted">{t('settings.subtitle')}</p>
        </div>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={scope === 'GLOBAL' ? 'primary' : 'secondary'}
            onClick={() => setScope('GLOBAL')}
          >
            {t('settings.scopeGlobal')}
          </Button>
          <Button
            variant={scope === 'DEPOT' ? 'primary' : 'secondary'}
            onClick={() => setScope('DEPOT')}
          >
            {t('settings.scopeDepot')}
          </Button>
        </div>
        {scope === 'DEPOT' &&
          (depots.length === 0 ? (
            <p className="text-sm text-muted">{t('settings.noDepots')}</p>
          ) : (
            <select
              value={depotId ?? ''}
              onChange={(e) => setDepotId(e.target.value || null)}
              className={selectClass()}
            >
              <option value="" disabled>
                {t('settings.pickDepot')}
              </option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ))}
      </Card>

      {(scope === 'GLOBAL' || depotId) &&
        SETTINGS_SERVICES.map((svc) => (
          <ServiceSection key={svc.id} base={svc.base} label={svc.label} scope={scope} depotId={depotId} />
        ))}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageDepots(customer?.role)) {
    return (
      <CenterState title={t('settings.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('settings.gateBody')}
      </CenterState>
    );
  }
  return <SettingsBody />;
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
