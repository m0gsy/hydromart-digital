'use client';

import { Plus, Trash } from '@phosphor-icons/react';

import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { blankOwnerRow, type OwnerRowForm } from '@/lib/depots';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page } from '@/lib/types';

const selectClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

/**
 * The owners of a franchise depot and the percent of its revenue each one takes. A depot may
 * belong to one person (they take 100%) or several, as agreed. Shared by the HQ onboard form
 * and the ops depot console because both POST the same depot payload.
 *
 * The total is shown as it is typed; the rule itself (sums to 100, one primary) lives in
 * `toDepotPayload` and again in depot-service, so this component only has to make it visible.
 */
export function OwnersEditor({
  value,
  onChange,
  idPrefix = 'd-owner',
}: {
  value: OwnerRowForm[];
  onChange: (rows: OwnerRowForm[]) => void;
  idPrefix?: string;
}) {
  const { t } = useT();
  const owners = useAsync<Page<Customer>>(() =>
    api.get(endpoints.auth.staff({ role: 'FRANCHISE_OWNER', limit: 100 }), true),
  );
  const options = owners.data?.items ?? [];
  const hint = owners.error
    ? t('hq.depots.form.ownerLoadError')
    : !owners.loading && options.length === 0
      ? t('hq.depots.form.ownerEmpty')
      : t('hq.depots.form.ownersHint');

  const rows = value.length > 0 ? value : [blankOwnerRow(true)];
  const single = rows.length === 1;
  const total = rows.reduce((sum, r) => sum + (Number(r.sharePct) || 0), 0);
  const update = (i: number, patch: Partial<OwnerRowForm>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const makePrimary = (i: number) => onChange(rows.map((r, j) => ({ ...r, isPrimary: j === i })));
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    // Dropping the primary hands the flag to whoever is first, rather than leaving none.
    if (!next.some((r) => r.isPrimary) && next[0]) next[0] = { ...next[0], isPrimary: true };
    onChange(next);
  };

  return (
    <Field label={t('hq.depots.form.owners')} htmlFor={`${idPrefix}-0`} hint={hint}>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              id={`${idPrefix}-${i}`}
              aria-label={t('hq.depots.form.owner')}
              value={row.ownerId}
              onChange={(e) => update(i, { ownerId: e.target.value })}
              className={`${selectClass} min-w-0 flex-1`}
            >
              <option value="">{t('hq.depots.form.ownerPick')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName || o.phone}
                </option>
              ))}
            </select>
            <div className="w-24">
              <Input
                aria-label={t('hq.depots.form.ownerShare')}
                inputMode="decimal"
                value={single ? '100' : row.sharePct}
                disabled={single}
                onChange={(e) => update(i, { sharePct: e.target.value })}
                placeholder="%"
              />
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="radio"
                name={`${idPrefix}-primary`}
                checked={single || row.isPrimary}
                disabled={single}
                onChange={() => makePrimary(i)}
              />
              {t('hq.depots.form.ownerPrimary')}
            </label>
            {!single && (
              <Button
                variant="ghost"
                aria-label={t('hq.depots.form.ownerRemove')}
                onClick={() => remove(i)}
              >
                <Trash size={16} />
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onChange([...rows, blankOwnerRow(false)])}>
            <Plus size={16} /> {t('hq.depots.form.ownerAdd')}
          </Button>
          {!single && (
            <span
              className={`text-xs ${Math.round(total * 100) === 10_000 ? 'text-brand-700' : 'text-[color:var(--danger)]'}`}
            >
              {t('hq.depots.form.ownerTotal', { total: String(Math.round(total * 100) / 100) })}
            </span>
          )}
        </div>
      </div>
    </Field>
  );
}
