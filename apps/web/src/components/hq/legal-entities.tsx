'use client';

import { useMemo, useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  LEGAL_ENTITY_KINDS,
  nextPoint,
  pointOn,
  type AiGrantableRole,
  type LegalEntity,
  type LegalEntityDirectory,
  type LegalEntityKind,
  type LegalEntityPoint,
} from '@/lib/legal-entities';
import { useT } from '@/lib/locale-context';
import { todayWib } from '@/lib/wib';

const SELECT =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

/* ---------- The entities ---------- */

/** Add, rename, re-kind and switch off legal entities (legalEntityAdmin). */
export function EntitiesPanel({
  entities,
  onChanged,
}: {
  entities: LegalEntity[];
  onChanged: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LegalEntityKind>('FRANCHISEE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function add() {
    if (name.trim().length < 2) {
      setError(t('hq.legalEntities.entities.nameTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.legalEntities.entities, { name: name.trim(), kind }, true);
      toast(t('hq.legalEntities.entities.added', { name: name.trim() }), 'success');
      setName('');
      onChanged();
    } catch (err) {
      setError(messageOf(err, t('hq.common.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(entity: LegalEntity, active: boolean) {
    try {
      await api.patch(endpoints.legalEntities.update(entity.id), { active }, true);
      onChanged();
    } catch (err) {
      toast(messageOf(err, t('hq.common.actionFailed')), 'error');
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{t('hq.legalEntities.entities.heading')}</h2>
      {entities.length === 0 ? (
        <p className="text-sm text-muted">{t('hq.legalEntities.entities.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {entities.map((e) =>
            editing === e.id ? (
              <li key={e.id} className="py-3">
                <EntityEditForm
                  entity={e}
                  onDone={() => {
                    setEditing(null);
                    onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.name}</p>
                  <p className="text-xs text-muted">{t(`hq.legalEntities.kinds.${e.kind}`)}</p>
                </div>
                <Badge tone={e.active ? 'success' : 'neutral'}>
                  {e.active
                    ? t('hq.legalEntities.entities.active')
                    : t('hq.legalEntities.entities.inactive')}
                </Badge>
                <Toggle
                  on={e.active}
                  onChange={(v) => void setActive(e, v)}
                  label={t('hq.legalEntities.entities.toggle', { name: e.name })}
                />
                <Button variant="ghost" onClick={() => setEditing(e.id)}>
                  {t('hq.legalEntities.entities.edit')}
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <Field label={t('hq.legalEntities.entities.name')} htmlFor="le-new-name">
          <Input
            id="le-new-name"
            value={name}
            maxLength={200}
            placeholder={t('hq.legalEntities.entities.namePlaceholder')}
            onChange={(ev) => setName(ev.target.value)}
          />
        </Field>
        <KindSelect id="le-new-kind" value={kind} onChange={setKind} />
        <Button onClick={add} loading={busy}>
          {t('hq.legalEntities.entities.add')}
        </Button>
      </div>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

function KindSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: LegalEntityKind;
  onChange: (kind: LegalEntityKind) => void;
}) {
  const { t } = useT();
  return (
    <Field label={t('hq.legalEntities.entities.kind')} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(ev) => onChange(ev.target.value as LegalEntityKind)}
        className={SELECT}
      >
        {LEGAL_ENTITY_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`hq.legalEntities.kinds.${k}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function EntityEditForm({
  entity,
  onDone,
  onCancel,
}: {
  entity: LegalEntity;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [name, setName] = useState(entity.name);
  const [kind, setKind] = useState<LegalEntityKind>(entity.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (name.trim().length < 2) {
      setError(t('hq.legalEntities.entities.nameTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.legalEntities.update(entity.id),
        { name: name.trim(), kind, seenUpdatedAt: entity.updatedAt },
        true,
      );
      toast(t('hq.legalEntities.entities.saved'), 'success');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_WRITE') {
        // Changed since it was read: close and read again, or every retry sends the same version.
        toast(t('hq.common.staleWrite'), 'error');
        onDone();
        return;
      }
      setError(messageOf(err, t('hq.common.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold">{t('hq.legalEntities.entities.editing', { name: entity.name })}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <Field label={t('hq.legalEntities.entities.name')} htmlFor={`le-name-${entity.id}`}>
          <Input
            id={`le-name-${entity.id}`}
            value={name}
            maxLength={200}
            onChange={(ev) => setName(ev.target.value)}
          />
        </Field>
        <KindSelect id={`le-kind-${entity.id}`} value={kind} onChange={setKind} />
      </div>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('hq.legalEntities.entities.cancel')}
        </Button>
        <Button onClick={save} loading={busy}>
          {t('hq.legalEntities.entities.save')}
        </Button>
      </div>
    </div>
  );
}

/* ---------- Depots and employees ---------- */

export interface AssignRow {
  id: string;
  title: string;
  subtitle: string;
  /** A closed depot or someone who left: hidden unless asked for. */
  inactive: boolean;
  /** Newest first. */
  points: LegalEntityPoint[];
}

/**
 * Which legal entity each depot or employee belongs to, by date. One form for many rows: pick
 * them, pick the entity and the day, apply. The same day again corrects it.
 */
export function AssignPanel({
  title,
  hint,
  rows,
  entities,
  idsKey,
  assignUrl,
  pointUrl,
  onChanged,
}: {
  title: string;
  hint: string;
  rows: AssignRow[];
  entities: LegalEntity[];
  idsKey: 'depotIds' | 'employeeIds';
  assignUrl: string;
  pointUrl: (id: string) => string;
  onChanged: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const today = todayWib();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);
  const entityName = (id: string) => nameOf.get(id) ?? t('hq.legalEntities.assign.unknownEntity');
  const activeEntities = entities.filter((e) => e.active);
  const shown = rows.filter((r) => {
    if (r.inactive && !showInactive) return false;
    const q = query.trim().toLowerCase();
    return !q || r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q);
  });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShownSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  async function apply() {
    if (selected.size === 0) {
      setError(t('hq.legalEntities.assign.needRows'));
      return;
    }
    if (!entityId || !from) {
      setError(t('hq.legalEntities.assign.needEntity'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const written = await api.post<unknown[]>(
        assignUrl,
        { [idsKey]: [...selected], legalEntityId: entityId, effectiveFrom: from },
        true,
      );
      toast(
        written.length
          ? t('hq.legalEntities.assign.applied', { n: written.length })
          : t('hq.legalEntities.assign.unchanged'),
        written.length ? 'success' : 'info',
      );
      setSelected(new Set());
      onChanged();
    } catch (err) {
      setError(messageOf(err, t('hq.common.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function remove(point: LegalEntityPoint) {
    const ok = await confirm({
      title: t('hq.legalEntities.assign.removeTitle'),
      message: t('hq.legalEntities.assign.removeMessage', {
        name: entityName(point.legalEntityId),
        date: point.effectiveFrom,
      }),
      confirmLabel: t('hq.legalEntities.assign.remove'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(pointUrl(point.id), true);
      toast(t('hq.legalEntities.assign.removed'), 'success');
      onChanged();
    } catch (err) {
      toast(messageOf(err, t('hq.common.actionFailed')), 'error');
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('hq.legalEntities.assign.search')}
          placeholder={t('hq.legalEntities.assign.search')}
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(ev) => setShowInactive(ev.target.checked)}
          />
          {t('hq.legalEntities.assign.showInactive')}
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="w-10 px-2 py-2.5">
                <input
                  type="checkbox"
                  aria-label={t('hq.legalEntities.assign.selectAll')}
                  checked={allShownSelected}
                  onChange={toggleShown}
                />
              </th>
              <th className="px-2 py-2.5">{title}</th>
              <th className="px-2 py-2.5">{t('hq.legalEntities.assign.entity')}</th>
              <th className="px-2 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const now = pointOn(r.points, today);
              const next = nextPoint(r.points, today);
              return (
                <tr key={r.id} className="border-b border-app align-top last:border-0">
                  <td className="px-2 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={t('hq.legalEntities.assign.selectRow', { name: r.title })}
                      checked={selected.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-xs text-muted">
                      {r.subtitle}
                      {r.inactive ? ` · ${t('hq.legalEntities.assign.inactive')}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-2.5">
                    <p>{now ? entityName(now.legalEntityId) : t('hq.legalEntities.assign.none')}</p>
                    {next && (
                      <p className="text-xs text-muted">
                        {t('hq.legalEntities.assign.scheduled', {
                          date: next.effectiveFrom,
                          name: entityName(next.legalEntityId),
                        })}
                      </p>
                    )}
                    {open === r.id && (
                      <ul className="mt-2 flex flex-col gap-1">
                        {r.points.map((p) => (
                          <li key={p.id} className="flex items-center gap-2 text-xs">
                            <span className="tabular-nums">{p.effectiveFrom}</span>
                            <span className="min-w-0 flex-1 truncate">{entityName(p.legalEntityId)}</span>
                            <Button variant="ghost" onClick={() => void remove(p)}>
                              {t('hq.legalEntities.assign.remove')}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {r.points.length > 0 && (
                      <Button variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id
                          ? t('hq.legalEntities.assign.hideHistory')
                          : t('hq.legalEntities.assign.history', { n: r.points.length })}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {activeEntities.length === 0 ? (
        <p className="text-sm text-muted">{t('hq.legalEntities.assign.noEntities')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <Field label={t('hq.legalEntities.assign.entity')} htmlFor={`le-assign-${idsKey}`}>
            <select
              id={`le-assign-${idsKey}`}
              value={entityId}
              onChange={(ev) => setEntityId(ev.target.value)}
              className={SELECT}
            >
              <option value="">{t('hq.legalEntities.assign.pickEntity')}</option>
              {activeEntities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('hq.legalEntities.assign.from')} htmlFor={`le-from-${idsKey}`}>
            <Input
              id={`le-from-${idsKey}`}
              type="date"
              value={from}
              onChange={(ev) => setFrom(ev.target.value)}
            />
          </Field>
          <Button onClick={apply} loading={busy}>
            {t('hq.legalEntities.assign.apply')}
            {selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

/* ---------- The AI-web matrix ---------- */

const cellKey = (entityId: string, roleKey: string) => `${entityId}|${roleKey}`;

function grantsOf(entities: LegalEntity[]): Set<string> {
  return new Set(entities.flatMap((e) => e.aiReadRoles.map((r) => cellKey(e.id, r))));
}

/**
 * Roles x legal entities: who may read which entity in the AI web and the AI read API. Only
 * `legalEntityAiAccess` saves; everybody else on this screen sees it read-only.
 */
export function AiMatrixPanel({
  directory,
  canEdit,
  onSaved,
}: {
  directory: LegalEntityDirectory;
  canEdit: boolean;
  onSaved: (next: LegalEntityDirectory) => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const baseline = useMemo(() => grantsOf(directory.entities), [directory]);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(baseline));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entities, roles } = directory;

  const changes = useMemo(() => {
    const out: { legalEntityId: string; roleKey: string; granted: boolean }[] = [];
    for (const e of entities) {
      for (const r of roles) {
        const key = cellKey(e.id, r.key);
        if (draft.has(key) !== baseline.has(key)) {
          out.push({ legalEntityId: e.id, roleKey: r.key, granted: draft.has(key) });
        }
      }
    }
    return out;
  }, [draft, baseline, entities, roles]);

  const roleLabel = (r: AiGrantableRole) => r.name ?? t(`hq.roles.${r.key}`);

  function toggle(key: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.put<LegalEntityDirectory>(endpoints.legalEntities.aiGrants, { changes }, true);
      toast(t('hq.legalEntities.matrix.saved'), 'success');
      setDraft(grantsOf(next.entities));
      onSaved(next);
    } catch (err) {
      setError(messageOf(err, t('hq.common.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">{t('hq.legalEntities.matrix.heading')}</h2>
        <p className="mt-1 text-sm text-muted">{t('hq.legalEntities.matrix.hint')}</p>
        {!canEdit && <p className="mt-1 text-sm font-medium">{t('hq.legalEntities.matrix.readOnly')}</p>}
      </div>
      {entities.length === 0 ? (
        <p className="text-sm text-muted">{t('hq.legalEntities.matrix.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium text-muted">
                <th className="px-2 py-2.5">{t('hq.legalEntities.matrix.role')}</th>
                {entities.map((e) => (
                  <th key={e.id} className="max-w-[10rem] px-2 py-2.5 text-center" title={e.name}>
                    <span className="line-clamp-2">{e.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-app">
                <th scope="row" className="px-2 py-2 text-left font-medium">
                  {t('hq.roles.SUPER_ADMIN')}
                </th>
                {entities.map((e) => (
                  <td key={e.id} className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      aria-label={t('hq.legalEntities.matrix.cell', {
                        role: t('hq.roles.SUPER_ADMIN'),
                        name: e.name,
                      })}
                    />
                  </td>
                ))}
              </tr>
              {roles.map((r) => (
                <tr key={r.key} className="border-b border-app last:border-0">
                  <th scope="row" className="px-2 py-2 text-left font-medium">
                    {roleLabel(r)}
                  </th>
                  {entities.map((e) => {
                    const key = cellKey(e.id, r.key);
                    return (
                      <td key={e.id} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={draft.has(key)}
                          disabled={!canEdit || busy}
                          onChange={() => toggle(key)}
                          aria-label={t('hq.legalEntities.matrix.cell', { role: roleLabel(r), name: e.name })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && changes.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-muted">{t('hq.legalEntities.matrix.dirty', { n: changes.length })}</span>
          <Button variant="ghost" onClick={() => setDraft(new Set(baseline))} disabled={busy}>
            {t('hq.legalEntities.matrix.reset')}
          </Button>
          <Button onClick={save} loading={busy}>
            {t('hq.legalEntities.matrix.save')}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
