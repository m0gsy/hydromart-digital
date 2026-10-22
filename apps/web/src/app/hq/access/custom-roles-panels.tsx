'use client';

import { useEffect, useMemo, useState } from 'react';

import { CAPABILITIES, CUSTOM_FORBIDDEN, type Capability, type CustomRoleDef } from '@hydromart/access';
import { useConfirm } from '@/components/confirm';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { roleLabel } from '@/lib/custom-role';
import type { DepotAdmin, Page } from '@/lib/types';

import { compiledScope } from './built-in-roles-panel';
import type { AccessMatrixResponse } from './rbac-matrix';

type Scope = CustomRoleDef['scope'];
const SCOPES: Scope[] = ['LOCKED', 'RESOLVED', 'GLOBAL'];

interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  scope: Scope;
  archivedAt: string | null;
}

const DEPOT_RULE_ROLES = [
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
];

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function CustomRolesPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useT();
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<Scope>('LOCKED');
  const [copyFrom, setCopyFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<RoleRow[]>(endpoints.auth.accessRoles, true));
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const active = rows.filter((r) => r.archivedAt === null);

  function startEdit(r: RoleRow | null) {
    setEditing(r ? r.key : '');
    setName(r?.name ?? '');
    setDescription(r?.description ?? '');
    setScope(r?.scope ?? 'LOCKED');
    setCopyFrom('');
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name, description: description || null, scope };
      if (editing) await api.put(endpoints.auth.accessRole(editing), body, true);
      else await api.post(endpoints.auth.accessRoles, copyFrom ? { ...body, copyFrom } : body, true);
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function archive(key: string) {
    if (
      !(await confirm({
        title: t('hqFix.roles.archive'),
        message: t('hqFix.roles.archiveConfirm'),
        confirmLabel: t('hqFix.roles.archive'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.auth.accessRole(key), true);
      await load();
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{t('hqFix.roles.title')}</h2>
          <p className="max-w-3xl text-xs text-muted">{t('hqFix.roles.intro')}</p>
        </div>
        {editing === null && <Button onClick={() => startEdit(null)}>{t('hqFix.roles.create')}</Button>}
      </div>

      {editing !== null && (
        <div className="grid gap-3 rounded-lg border border-app p-3 sm:grid-cols-2">
          <Field label={t('hqFix.roles.name')}>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!editing && (
            <Field label={t('hqFix.roles.builtIn.copyFrom')}>
              <select
                value={copyFrom}
                onChange={(e) => {
                  setCopyFrom(e.target.value);
                  if (e.target.value) setScope(compiledScope(e.target.value));
                }}
                className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
              >
                <option value="">{t('hqFix.roles.builtIn.copyNone')}</option>
                {DEPOT_RULE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`hq.roles.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('hqFix.roles.scope')} hint={t('hqFix.roles.scopeHint')}>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`hqFix.roles.scope${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('hqFix.roles.description')}>
              <Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={save} loading={busy} disabled={name.trim().length < 2}>
              {t('hqFix.roles.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              {t('hqFix.roles.cancel')}
            </Button>
          </div>
        </div>
      )}
      <FormError message={error} className="text-xs text-danger" />

      {active.length === 0 ? (
        <p className="text-sm text-muted">{t('hqFix.roles.empty')}</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {active.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {r.name} <span className="text-xs text-muted">· {r.key}</span>
                </p>
                <p className="text-xs text-muted">
                  {t(`hqFix.roles.scope${r.scope}`)}
                  {r.description ? ` · ${r.description}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => startEdit(r)} disabled={busy}>
                  {t('hqFix.roles.edit')}
                </Button>
                <Button variant="ghost" onClick={() => archive(r.key)} disabled={busy}>
                  {t('hqFix.roles.archive')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DepotRulesPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useT();
  const [data, setData] = useState<AccessMatrixResponse>({});
  const [depots, setDepots] = useState<DepotAdmin[]>([]);
  // null = still loading, false = failed. An unresolved depot id is only "unknown" once the list loaded.
  const [depotsLoaded, setDepotsLoaded] = useState<boolean | null>(null);
  const [capability, setCapability] = useState<Capability>('dashboard');
  const [roleKey, setRoleKey] = useState('STAFF_DEPOT');
  const [depotId, setDepotId] = useState('');
  const [effect, setEffect] = useState<'GRANT' | 'DENY'>('GRANT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.get<AccessMatrixResponse>(endpoints.auth.matrix, true));
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    void load();
  }, [refreshKey]);
  useEffect(() => {
    api
      .getCached<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true)
      .then((p) => {
        setDepots(p.items);
        setDepotsLoaded(p.items.length >= p.total || p.items.length < 100);
      })
      .catch((err: unknown) => {
        setDepotsLoaded(false);
        setError(message(err));
      });
  }, []);

  const depotName = useMemo(() => new Map(depots.map((d) => [d.id, `${d.name} · ${d.code}`] as const)), [depots]);
  const customRoles = data.customRoles ?? [];
  const nameOf = (key: string): string =>
    customRoles.find((r) => r.key === key)?.name ?? roleLabel(t, key);
  // SUPER_ADMIN bypasses every check, so an exception for it could only mislead; CUSTOMER is not staff.
  const roleOptions = [...DEPOT_RULE_ROLES, ...customRoles.map((r) => r.key)];
  const capabilityOptions = (Object.keys(CAPABILITIES) as Capability[]).filter(
    (c) => !(roleKey.startsWith('C_') && (CUSTOM_FORBIDDEN as readonly string[]).includes(c)),
  );
  const safeCapability = capabilityOptions.includes(capability) ? capability : capabilityOptions[0] ?? 'dashboard';

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.put(endpoints.auth.depotOverride(safeCapability, depotId), { roleKey, effect }, true);
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(o: { capability: string; roleKey: string; depotId: string }) {
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.auth.depotOverrideReset(o.capability, o.depotId, o.roleKey), true);
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = data.depotOverrides ?? [];
  const selectCls = 'surface-elevated min-w-0 rounded-lg border border-app px-3 py-2.5 text-sm';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <h2 className="font-semibold">{t('hqFix.depotRules.title')}</h2>
        <p className="max-w-3xl text-xs text-muted">{t('hqFix.depotRules.intro')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('hqFix.depotRules.role')}>
          <select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} className={selectCls}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {nameOf(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hqFix.depotRules.capability')}>
          <select
            value={safeCapability}
            onChange={(e) => setCapability(e.target.value as Capability)}
            className={selectCls}
          >
            {capabilityOptions.map((c) => (
              <option key={c} value={c}>
                {t(`hq.access.caps.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hqFix.depotRules.depot')}>
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)} className={selectCls}>
            <option value="">{t('hqFix.depotRules.pickDepot')}</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hqFix.depotRules.effect')}>
          <select
            value={effect}
            onChange={(e) => setEffect(e.target.value as 'GRANT' | 'DENY')}
            className={selectCls}
          >
            <option value="GRANT">{t('hqFix.depotRules.grant')}</option>
            <option value="DENY">{t('hqFix.depotRules.deny')}</option>
          </select>
        </Field>
      </div>
      <div>
        <Button onClick={add} loading={busy} disabled={!depotId}>
          {t('hqFix.depotRules.add')}
        </Button>
      </div>
      <FormError message={error} className="text-xs text-danger" />
      {depotsLoaded === false && (
        <p className="text-xs font-medium text-danger" role="alert">
          {t('hqFix.depotRules.depotsIncomplete')}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('hqFix.depotRules.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <tbody>
              {rows.map((o) => (
                <tr key={`${o.capability}|${o.roleKey}|${o.depotId}`} className="border-t border-app">
                  <td className="py-2 pr-3">{nameOf(o.roleKey)}</td>
                  <td className="py-2 pr-3">{t(`hq.access.caps.${o.capability}`)}</td>
                  <td className="py-2 pr-3">
                    {depotName.get(o.depotId) ??
                      (depotsLoaded === true ? t('hqFix.depotRules.unknownDepot') : o.depotId)}
                  </td>
                  <td className="py-2 pr-3 font-semibold">
                    {o.effect === 'GRANT' ? t('hqFix.depotRules.grant') : t('hqFix.depotRules.deny')}
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" onClick={() => remove(o)} disabled={busy}>
                      {t('hqFix.depotRules.remove')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
