'use client';

import { useEffect, useId, useMemo, useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
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

/** A `YYYY-MM-DD` business day as people read it ("1 Des 2026"). UTC midnight is that day in WIB. */
const dayLabel = (day: string): string => formatDate(`${day}T00:00:00.000Z`);

/* ---------- The entities ---------- */

/** Add, rename, re-kind and switch off legal entities (legalEntityAdmin). */
export function EntitiesPanel({
  entities,
  onChanged,
}: {
  entities: LegalEntity[];
  /** Reads the entities again; resolves once the new copy is on screen. */
  onChanged: () => Promise<void>;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const headingId = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LegalEntityKind>('FRANCHISEE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

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
      await onChanged();
    } catch (err) {
      setError(messageOf(err, t('hq.common.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(entity: LegalEntity, active: boolean) {
    // Switching off is one tap from a wrong picker for every new depot and employee: asked first.
    if (
      !active &&
      !(await confirm({
        title: t('hq.legalEntities.entities.offTitle', { name: entity.name }),
        message: t('hq.legalEntities.entities.offMessage'),
        confirmLabel: t('hq.legalEntities.entities.offConfirm'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    setToggling(entity.id);
    try {
      await api.patch(endpoints.legalEntities.update(entity.id), { active }, true);
    } catch (err) {
      toast(messageOf(err, t('hq.common.actionFailed')), 'error');
    } finally {
      // Saved or refused, the list is read again (a refusal shows why), and the switch stays held
      // until the new copy is on screen, so a second tap acts on what is really stored.
      await onChanged();
      setToggling(null);
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <Card className="flex flex-col gap-4 p-5">
        <h2 id={headingId} className="text-lg font-bold">
          {t('hq.legalEntities.entities.heading')}
        </h2>
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
                      void onChanged();
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
                    disabled={toggling === e.id}
                    onChange={(v) => void setActive(e, v)}
                    label={t('hq.legalEntities.entities.toggle', { name: e.name })}
                  />
                  <Button
                    variant="ghost"
                    aria-label={t('hq.legalEntities.entities.editing', { name: e.name })}
                    onClick={() => setEditing(e.id)}
                  >
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
    </section>
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
  // The copy this form was opened on. A reload while it is open hands in a newer `entity`; the
  // version sent back must stay the one the inputs were filled from, or another admin's change
  // in between would pass the freshness check and be overwritten.
  const [opened] = useState(entity);
  const [name, setName] = useState(entity.name);
  const [kind, setKind] = useState<LegalEntityKind>(entity.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changedElsewhere = entity.updatedAt !== opened.updatedAt;

  async function save() {
    if (name.trim().length < 2) {
      setError(t('hq.legalEntities.entities.nameTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.legalEntities.update(opened.id),
        { name: name.trim(), kind, seenUpdatedAt: opened.updatedAt },
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
      <p className="text-sm font-semibold">{t('hq.legalEntities.entities.editing', { name: opened.name })}</p>
      {changedElsewhere && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {t('hq.legalEntities.entities.changedElsewhere')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <Field label={t('hq.legalEntities.entities.name')} htmlFor={`le-name-${opened.id}`}>
          <Input
            id={`le-name-${opened.id}`}
            value={name}
            maxLength={200}
            onChange={(ev) => setName(ev.target.value)}
          />
        </Field>
        <KindSelect id={`le-kind-${opened.id}`} value={kind} onChange={setKind} />
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
  /** Lower-case text the search box matches: everything shown plus the raw codes. */
  searchText: string;
  /** A closed depot or someone who left: hidden unless asked for. */
  inactive: boolean;
  /** Newest first. */
  points: LegalEntityPoint[];
}

/**
 * Which legal entity each depot or employee belongs to, by date. One form for many rows: pick
 * them, pick the entity and the day, apply. The same day again corrects it. A selection larger
 * than the server takes in one request is sent in batches, each safe to repeat.
 */
export function AssignPanel({
  kind,
  rows,
  entities,
  idsKey,
  batchSize,
  assignUrl,
  pointUrl,
  onChanged,
}: {
  kind: 'depots' | 'employees';
  rows: AssignRow[];
  entities: LegalEntity[];
  idsKey: 'depotIds' | 'employeeIds';
  /** The most ids the server accepts in one request (depots 200, employees 500). */
  batchSize: number;
  assignUrl: string;
  /** Take back one point, naming the entity this screen shows on it. */
  pointUrl: (id: string, legalEntityId: string) => string;
  /** Reads this list again; resolves once the new copy is on screen. */
  onChanged: () => Promise<void>;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const headingId = useId();
  const today = todayWib();
  const label = (key: string, vars?: Record<string, string | number>) =>
    t(`hq.legalEntities.assign.${kind}.${key}`, vars);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const entityName = (id: string) => nameOf.get(id) ?? t('hq.legalEntities.assign.unknownEntity');
  const activeEntities = entities.filter((e) => e.active);
  // An entity switched off after it was picked is no longer a choice: the picker shows none.
  const chosenId = activeEntities.some((e) => e.id === entityId) ? entityId : '';
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (showInactive || !r.inactive) && (!q || r.searchText.includes(q)));
  const shownIds = new Set(shown.map((r) => r.id));
  const hiddenSelected = [...selected].filter((id) => !shownIds.has(id)).length;
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
    if (!chosenId || !from) {
      setError(t('hq.legalEntities.assign.needEntity'));
      return;
    }
    // Ticks from an earlier search or a hidden filter are real picks, but nobody should apply
    // them without seeing that they are there.
    if (
      hiddenSelected > 0 &&
      !(await confirm({
        title: t('hq.legalEntities.assign.applyHiddenTitle'),
        message: t('hq.legalEntities.assign.applyHiddenMessage', { n: selected.size, m: hiddenSelected }),
        confirmLabel: t('hq.legalEntities.assign.applyHiddenConfirm'),
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const ids = [...selected];
    let written = 0;
    try {
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        // What this screen shows for that day, so the server refuses to erase a write it did not show.
        const seen = batch.flatMap((id) => {
          const point = rowById.get(id)?.points.find((p) => p.effectiveFrom === from);
          return point ? [{ id, legalEntityId: point.legalEntityId }] : [];
        });
        const done = await api.post<unknown[]>(
          assignUrl,
          { [idsKey]: batch, legalEntityId: chosenId, effectiveFrom: from, seen },
          true,
        );
        written += done.length;
      }
      toast(
        written
          ? t('hq.legalEntities.assign.applied', { n: written })
          : t('hq.legalEntities.assign.unchanged'),
        written ? 'success' : 'info',
      );
      setSelected(new Set());
    } catch (err) {
      // Batches already sent are saved; the reload below shows exactly what landed.
      setError(
        err instanceof ApiError && err.code === 'STALE_WRITE'
          ? t('hq.common.staleWrite')
          : messageOf(err, t('hq.common.actionFailed')),
      );
      if (written) toast(t('hq.legalEntities.assign.applied', { n: written }), 'success');
    } finally {
      // Held until the new copy is on screen: a second apply right after this one must be built
      // on what this one wrote, or it would be refused as somebody else's change.
      await onChanged();
      setBusy(false);
    }
  }

  async function remove(point: LegalEntityPoint) {
    const ok = await confirm({
      title: t('hq.legalEntities.assign.removeTitle'),
      message: t('hq.legalEntities.assign.removeMessage', {
        name: entityName(point.legalEntityId),
        date: dayLabel(point.effectiveFrom),
      }),
      confirmLabel: t('hq.legalEntities.assign.remove'),
      tone: 'danger',
    });
    if (!ok) return;
    setRemoving(point.id);
    try {
      await api.del(pointUrl(point.id, point.legalEntityId), true);
      toast(t('hq.legalEntities.assign.removed'), 'success');
    } catch (err) {
      toast(
        err instanceof ApiError && err.code === 'STALE_WRITE'
          ? t('hq.common.staleWrite')
          : messageOf(err, t('hq.common.actionFailed')),
        'error',
      );
    } finally {
      // Taken back, already gone or corrected since: the list is read again, so no ghost row stays.
      await onChanged();
      setRemoving(null);
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 id={headingId} className="text-lg font-bold">
            {label('title')}
          </h2>
          <p className="mt-1 text-sm text-muted">{label('hint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label={label('search')}
            placeholder={label('search')}
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
            {label('showInactive')}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="w-10 px-2 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={label('selectAll')}
                    checked={allShownSelected}
                    onChange={toggleShown}
                  />
                </th>
                <th className="px-2 py-2.5">{label('title')}</th>
                <th className="px-2 py-2.5">{t('hq.legalEntities.assign.entity')}</th>
                <th className="px-2 py-2.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-center text-sm text-muted">
                    {label('noRows')}
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const now = pointOn(r.points, today);
                const next = nextPoint(r.points, today);
                const historyId = `${headingId}-h-${r.id}`;
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
                            date: dayLabel(next.effectiveFrom),
                            name: entityName(next.legalEntityId),
                          })}
                        </p>
                      )}
                      {open === r.id && (
                        <ul id={historyId} className="mt-2 flex flex-col gap-1">
                          {r.points.map((p) => (
                            <li key={p.id} className="flex items-center gap-2 text-xs">
                              <span className="tabular-nums">{dayLabel(p.effectiveFrom)}</span>
                              <span className="min-w-0 flex-1 truncate">{entityName(p.legalEntityId)}</span>
                              <Button
                                variant="ghost"
                                disabled={removing !== null}
                                aria-label={t('hq.legalEntities.assign.removeOne', {
                                  name: entityName(p.legalEntityId),
                                  date: dayLabel(p.effectiveFrom),
                                })}
                                onClick={() => void remove(p)}
                              >
                                {t('hq.legalEntities.assign.remove')}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {r.points.length > 0 && (
                        <Button
                          variant="ghost"
                          aria-expanded={open === r.id}
                          aria-controls={open === r.id ? historyId : undefined}
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                        >
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
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('hq.legalEntities.assign.selected', { n: selected.size })}</span>
            {hiddenSelected > 0 && (
              <span className="font-medium">
                {t('hq.legalEntities.assign.selectedHidden', { m: hiddenSelected })}
              </span>
            )}
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              {t('hq.legalEntities.assign.clearSelection')}
            </Button>
          </div>
        )}
        {activeEntities.length === 0 ? (
          <p className="text-sm text-muted">{t('hq.legalEntities.assign.noEntities')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <Field label={t('hq.legalEntities.assign.entity')} htmlFor={`le-assign-${idsKey}`}>
              <select
                id={`le-assign-${idsKey}`}
                value={chosenId}
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
            <Button aria-label={label('apply')} onClick={apply} loading={busy}>
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
    </section>
  );
}

/* ---------- The AI-web matrix ---------- */

const cellKey = (entityId: string, roleKey: string) => `${entityId}|${roleKey}`;

/**
 * Roles x legal entities: who may read which entity in the AI web and the AI read API. Only
 * `legalEntityAiAccess` saves; everybody else on this screen sees it read-only.
 *
 * The unsaved work is kept as EDITS (the cells somebody changed and to what), not as a copy of
 * the whole grid, so a reload of the directory moves the baseline under them without losing
 * them, and a save sends only those cells: the server applies each as an absolute set, so a
 * grant somebody else made meanwhile is never touched.
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
  const headingId = useId();
  const { entities, roles } = directory;
  const baseline = useMemo(
    () => new Set(entities.flatMap((e) => e.aiReadRoles.map((r) => cellKey(e.id, r)))),
    [entities],
  );
  const [edits, setEdits] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new copy may already hold an edit (somebody else made the same change), or no longer have
  // its row or column. Such an edit is dropped, not hidden: kept, it would come back as a change
  // the next time the copy moved away from it, and be saved without anybody choosing to.
  useEffect(() => {
    const cells = new Set(entities.flatMap((e) => roles.map((r) => cellKey(e.id, r.key))));
    setEdits((prev) => {
      const next = new Map([...prev].filter(([key, want]) => cells.has(key) && want !== baseline.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [baseline, entities, roles]);

  const isOn = (key: string): boolean => edits.get(key) ?? baseline.has(key);

  const changes = useMemo(() => {
    const out: { legalEntityId: string; roleKey: string; granted: boolean }[] = [];
    for (const e of entities) {
      for (const r of roles) {
        const want = edits.get(cellKey(e.id, r.key));
        // An edit the reload made true already, or one on a vanished row, is not a change.
        if (want !== undefined && want !== baseline.has(cellKey(e.id, r.key))) {
          out.push({ legalEntityId: e.id, roleKey: r.key, granted: want });
        }
      }
    }
    return out;
  }, [edits, baseline, entities, roles]);

  const roleLabel = (r: AiGrantableRole) => r.name ?? t(`hq.roles.${r.key}`);

  function toggle(key: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      const want = !(prev.get(key) ?? baseline.has(key));
      if (want === baseline.has(key)) next.delete(key);
      else next.set(key, want);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.put<LegalEntityDirectory>(endpoints.legalEntities.aiGrants, { changes }, true);
      toast(t('hq.legalEntities.matrix.saved'), 'success');
      setEdits(new Map());
      onSaved(next);
    } catch (err) {
      setError(messageOf(err, t('hq.common.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 id={headingId} className="text-lg font-bold">
            {t('hq.legalEntities.matrix.heading')}
          </h2>
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
                            checked={isOn(key)}
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
            <Button variant="ghost" onClick={() => setEdits(new Map())} disabled={busy}>
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
    </section>
  );
}
