'use client';

import { useEffect, useState } from 'react';

import { SCOPE_FIXED_ROLES, UNDISABLEABLE_ROLES, type CustomRoleDef, type RoleSetting } from '@hydromart/access';
import { useConfirm } from '@/components/confirm';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

import type { AccessMatrixResponse } from './rbac-matrix';

type Scope = CustomRoleDef['scope'];
const SCOPES: Scope[] = ['LOCKED', 'RESOLVED', 'GLOBAL'];
const RANK: Record<Scope, number> = { LOCKED: 0, RESOLVED: 1, GLOBAL: 2 };

/** Reach each built-in role is compiled with (mirrors @hydromart/platform depot-scope). */
export const COMPILED_SCOPE: Record<string, Scope> = {
  STAFF_DEPOT: 'LOCKED',
  KEPALA_DEPOT: 'LOCKED',
  ASSISTANT_SUPERVISOR: 'RESOLVED',
  SUPERVISOR: 'RESOLVED',
  MANAGER: 'RESOLVED',
};
export const compiledScope = (role: string): Scope => COMPILED_SCOPE[role] ?? 'GLOBAL';

/** Every built-in role except CUSTOMER (the shopper), which is not a staff role. */
export const BUILT_IN_EDITABLE = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
];

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isFixed = (role: string): boolean => (SCOPE_FIXED_ROLES as readonly string[]).includes(role);

/**
 * The built-in roles: rename, describe, rescope, switch off. Their capabilities stay in the
 * matrix; nothing here can delete one, and SUPER_ADMIN can never be switched off.
 */
export function BuiltInRolesPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const { t } = useT();
  const { confirm } = useConfirm();
  const [settings, setSettings] = useState<Map<string, RoleSetting>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'' | Scope>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<AccessMatrixResponse>(endpoints.auth.matrix, true);
      setSettings(new Map((res.roleSettings ?? []).map((r) => [r.roleKey, r] as const)));
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    void load();
  }, [refreshKey]);

  function startEdit(role: string) {
    const cur = settings.get(role);
    setEditing(role);
    setName(cur?.name ?? '');
    setDescription(cur?.description ?? '');
    setScope(cur?.scope ?? '');
    setError(null);
  }

  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await job();
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const save = (role: string) =>
    run(() =>
      api.put(
        endpoints.auth.accessBuiltIn(role),
        {
          name: name || null,
          description: description || null,
          ...(isFixed(role) ? {} : { scope: scope || null }),
        },
        true,
      ),
    );

  async function toggle(role: string, disabled: boolean) {
    if (
      disabled &&
      !(await confirm({
        title: t('hqFix.roles.builtIn.disable'),
        message: t('hqFix.roles.builtIn.confirmDisable'),
        confirmLabel: t('hqFix.roles.builtIn.disable'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    await run(() => api.put(endpoints.auth.accessBuiltInDisabled(role), { disabled }, true));
  }

  const selectCls = 'surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <h2 className="font-semibold">{t('hqFix.roles.builtIn.title')}</h2>
        <p className="max-w-3xl text-xs text-muted">{t('hqFix.roles.builtIn.intro')}</p>
      </div>
      <FormError message={error} className="text-xs text-danger" />
      <ul className="divide-y divide-[color:var(--border)]">
        {BUILT_IN_EDITABLE.map((role) => {
          const cur = settings.get(role);
          const off = cur?.disabled === true;
          const fixed = isFixed(role);
          const effective = cur?.scope ?? compiledScope(role);
          return (
            <li key={role} className="flex flex-col gap-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={'font-medium' + (off ? ' text-muted line-through' : '')}>
                    {cur?.name || t(`hq.roles.${role}`)} <span className="text-xs text-muted">· {role}</span>
                    {off && <span className="ml-2 text-xs">({t('hqFix.roles.builtIn.disabled')})</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {fixed ? t('hqFix.roles.builtIn.scopeKept') : t(`hqFix.roles.scope${effective}`)}
                    {cur?.description ? ` · ${cur.description}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => startEdit(role)} disabled={busy}>
                    {t('hqFix.roles.edit')}
                  </Button>
                  {!(UNDISABLEABLE_ROLES as readonly string[]).includes(role) && (
                    <Button variant="ghost" onClick={() => toggle(role, !off)} disabled={busy}>
                      {off ? t('hqFix.roles.builtIn.enable') : t('hqFix.roles.builtIn.disable')}
                    </Button>
                  )}
                </div>
              </div>
              {editing === role && (
                <div className="grid gap-3 rounded-lg border border-app p-3 sm:grid-cols-2">
                  <Field label={t('hqFix.roles.name')}>
                    <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  {!fixed && (
                    <Field label={t('hqFix.roles.scope')} hint={t('hqFix.roles.scopeHint')}>
                      <select
                        value={scope}
                        onChange={(e) => setScope(e.target.value as '' | Scope)}
                        className={selectCls}
                      >
                        <option value="">{t('hqFix.roles.builtIn.reset')}</option>
                        {SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {t(`hqFix.roles.scope${s}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <div className="sm:col-span-2">
                    <Field label={t('hqFix.roles.description')}>
                      <Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
                    </Field>
                  </div>
                  {!fixed && scope !== '' && RANK[scope] > RANK[compiledScope(role)] && (
                    <p className="text-xs font-medium text-[color:var(--danger)] sm:col-span-2" role="alert">
                      {t('hqFix.roles.builtIn.widen')}
                    </p>
                  )}
                  <div className="flex gap-2 sm:col-span-2">
                    <Button onClick={() => save(role)} loading={busy}>
                      {t('hqFix.roles.save')}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                      {t('hqFix.roles.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
