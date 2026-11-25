'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { SopSummary } from '@/lib/sop';
import { useAsync } from '@/lib/use-async';
import { MAX_TEMPLATE_ITEMS, type VisitTemplate, type VisitTemplateBody } from '@/lib/visit-templates';

interface Row {
  key: number;
  text: string;
  sopId: string;
}

/**
 * HD-15B — write or edit one visit template: a name, an active flag and an ordered checklist, each
 * line optionally pointing at a SOP. Saving replaces the whole checklist (the server does it in one
 * transaction). The server checks every bound again; this form only spares a round trip.
 */
export function VisitTemplateForm({
  template,
  onClose,
  onSaved,
}: {
  /** Set = edit this template; unset = create a new one. */
  template?: VisitTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [name, setName] = useState(template?.name ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [nextKey, setNextKey] = useState(template ? template.items.length : 1);
  const [rows, setRows] = useState<Row[]>(
    template
      ? template.items.map((it, key) => ({ key, text: it.text, sopId: it.sopId ?? '' }))
      : [{ key: 0, text: '', sopId: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The SOP list only decorates the form: if it fails the template can still be saved.
  const sops = useAsync<SopSummary[]>(() => api.get(endpoints.hr.sops, true), []);

  const valid = name.trim().length >= 3 && rows.length > 0 && rows.every((r) => r.text.trim().length >= 3);

  const setRow = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRows((prev) => {
      const to = index + by;
      if (to < 0 || to >= prev.length) return prev;
      const copy = [...prev];
      copy.splice(to, 0, ...copy.splice(index, 1));
      return copy;
    });

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const items: VisitTemplateBody['items'] = rows.map((r) => ({
      text: r.text.trim(),
      ...(r.sopId ? { sopId: r.sopId } : {}),
    }));
    try {
      if (template) {
        // CA-2-53: the `updatedAt` this form was opened on, so a second editor's save is refused.
        await api.put(
          endpoints.visitTemplates.update(template.id),
          { name: name.trim(), active, items, seenUpdatedAt: template.updatedAt },
          true,
        );
      } else {
        await api.post(endpoints.visitTemplates.create, { name: name.trim(), items }, true);
      }
      toast(t('hq.visitTemplates.form.saved'), 'success');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_WRITE') {
        // Drop the form and re-read: keeping it would re-send the very values just refused.
        toast(t('hq.common.staleWrite'), 'error');
        onSaved();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('hq.visitTemplates.form.saveError'));
    } finally {
      setBusy(false);
    }
  }

  // A SOP the template names that the list no longer returns stays selectable, so saving
  // another line never silently drops it.
  const knownSops = sops.data ?? [];
  const optionsFor = (current: string) =>
    current && !knownSops.some((s) => s.id === current)
      ? [...knownSops, { id: current, title: t('hq.visitTemplates.sopUnknown') } as SopSummary]
      : knownSops;

  return (
    <Sheet
      open
      onClose={onClose}
      title={template ? t('hq.visitTemplates.form.editTitle') : t('hq.visitTemplates.form.createTitle')}
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p className="text-sm text-[color:var(--danger)]" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('hq.visitTemplates.form.cancel')}
            </Button>
            <Button onClick={submit} disabled={!valid} loading={busy}>
              {t('hq.visitTemplates.form.submit')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('hq.visitTemplates.form.name')} htmlFor="vt-name">
          <Input
            id="vt-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('hq.visitTemplates.form.namePlaceholder')}
          />
        </Field>
        {template && (
          <label className="tap-44 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('hq.visitTemplates.form.active')}
          </label>
        )}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t('hq.visitTemplates.form.items')}</legend>
          {sops.error && (
            <p className="text-xs text-[color:var(--danger)]" role="alert">
              {t('hq.visitTemplates.form.sopLoadError')}
            </p>
          )}
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <div key={row.key} className="flex flex-col gap-2 rounded-lg border border-app p-3">
                <Field label={t('hq.visitTemplates.form.itemText', { n })} htmlFor={`vt-item-${row.key}`}>
                  <Input
                    id={`vt-item-${row.key}`}
                    value={row.text}
                    maxLength={300}
                    onChange={(e) => setRow(row.key, { text: e.target.value })}
                    placeholder={t('hq.visitTemplates.form.itemPlaceholder')}
                  />
                </Field>
                <Field label={t('hq.visitTemplates.form.sop')} htmlFor={`vt-sop-${row.key}`}>
                  <select
                    id={`vt-sop-${row.key}`}
                    value={row.sopId}
                    onChange={(e) => setRow(row.key, { sopId: e.target.value })}
                    className="surface-elevated min-h-11 w-full rounded-lg border border-app px-3 text-sm"
                  >
                    <option value="">{t('hq.visitTemplates.form.sopNone')}</option>
                    {optionsFor(row.sopId).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex flex-wrap gap-3 text-sm font-semibold text-brand-700">
                  <button
                    type="button"
                    className="tap-44"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t('hq.visitTemplates.form.moveUp', { n })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="tap-44"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={t('hq.visitTemplates.form.moveDown', { n })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="tap-44 text-[color:var(--danger)]"
                    disabled={rows.length === 1}
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    aria-label={t('hq.visitTemplates.form.removeItem', { n })}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          <div>
            <Button
              variant="secondary"
              disabled={rows.length >= MAX_TEMPLATE_ITEMS}
              onClick={() => {
                setRows((prev) => [...prev, { key: nextKey, text: '', sopId: '' }]);
                setNextKey((k) => k + 1);
              }}
            >
              {t('hq.visitTemplates.form.addItem')}
            </Button>
            {rows.length >= MAX_TEMPLATE_ITEMS && (
              <p className="mt-1 text-xs text-muted">{t('hq.visitTemplates.form.limit')}</p>
            )}
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}
