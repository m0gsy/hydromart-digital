'use client';

import { useState } from 'react';

import { Badge, Button, Field, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import {
  evaluateReseller,
  RESELLER_STATUS_LABEL,
  type Reseller,
  type ResellerPriceChange,
  type ResellerRollupRow,
} from '@/lib/reseller';
import { ResellerPhoto } from './reseller-photo';

/**
 * K4.2. Who changed this agen's terms, when, and what is still coming.
 *
 * The pending rows are the same rows as the history — a scheduled change is one that has
 * not been applied yet — so they are one list with one marker rather than two panels that
 * can disagree. Newest first, which puts anything scheduled at the top where it belongs.
 */
function PriceChangeHistory({
  history,
}: {
  history: ResellerPriceChange[] | 'loading' | 'error' | null;
}) {
  const { t } = useT();
  if (history === null) return null;
  if (history === 'loading') return <Skeleton className="mt-3 h-16" />;
  if (history === 'error') {
    return <p className="mt-3 text-xs text-muted">{t('hrFix.resellers.historyFailed')}</p>;
  }

  const label = (field: ResellerPriceChange['field']): string =>
    field === 'discountPct'
      ? t('hrFix.resellers.historyFieldDiscount')
      : field === 'flatGallonPriceIdr'
        ? t('hrFix.resellers.historyFieldFlat')
        : t('hrFix.resellers.historyFieldActive');

  // `active` is stored as the string "true"/"false" (one column pair for three fields),
  // so it is rendered as words rather than shown to a human as a JSON literal.
  const value = (field: ResellerPriceChange['field'], raw: string): string =>
    field !== 'active'
      ? raw
      : raw === 'true'
        ? t('hrFix.resellers.historyActiveTrue')
        : t('hrFix.resellers.historyActiveFalse');

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t('hrFix.resellers.history')}
      </div>
      {history.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{t('hrFix.resellers.historyEmpty')}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs text-muted">
          {history.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span>
                {new Date(c.effectiveAt).toLocaleDateString('id-ID')} · {label(c.field)}:{' '}
                {value(c.field, c.oldValue)} → {value(c.field, c.newValue)}
              </span>
              {c.appliedAt === null && (
                <Badge tone="neutral">{t('hrFix.resellers.historyPending')}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResellerRow({
  reseller: r,
  roll,
  name,
  onChanged,
}: {
  reseller: Reseller;
  roll: ResellerRollupRow | undefined;
  name: string | undefined;
  onChanged: () => void;
}) {
  const { t } = useT();
  const { toast: notify } = useToast();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(String(r.monthlyTargetQty));
  const [discount, setDiscount] = useState(String(r.discountPct));
  const [flatPrice, setFlatPrice] = useState(String(r.flatGallonPriceIdr));
  const [note, setNote] = useState(r.note ?? '');
  // K4.2: blank = now, which is every caller's behaviour before this existed. A date is
  // a plain `<input type="date">`; the browser already owns that widget and its locale.
  const [effectiveAt, setEffectiveAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [history, setHistory] = useState<ResellerPriceChange[] | 'loading' | 'error' | null>(null);
  // Unique per row: several agen editors can be open at once, and a label pointing at
  // another row's input is worse than no label at all.
  const effectiveAtId = `reseller-effective-${r.customerId}`;

  const m = evaluateReseller({
    volumeQty: roll?.volumeQty ?? 0,
    prevVolumeQty: roll?.prevVolumeQty ?? 0,
    monthlyTargetQty: r.monthlyTargetQty,
    lastOrderAt: roll?.lastOrderAt ?? null,
  });

  function openEdit() {
    setTarget(String(r.monthlyTargetQty));
    setDiscount(String(r.discountPct));
    setFlatPrice(String(r.flatGallonPriceIdr));
    setNote(r.note ?? '');
    setEffectiveAt('');
    setEditing(true);
    // K4.2: loaded when the editor opens rather than with the roster — the roster is one
    // request for every agen at the depot, and this is a per-agen read nobody looking at
    // the list has asked for.
    setHistory('loading');
    api
      .get<ResellerPriceChange[]>(endpoints.resellers.priceChanges(r.customerId), true)
      .then(setHistory)
      .catch(() => setHistory('error'));
  }

  async function saveEdit() {
    if (!(Number(target) >= 0)) {
      notify(t('hrFix.resellers.targetNumber'), 'error');
      return;
    }
    if (!(Number(discount) >= 0 && Number(discount) <= 100)) {
      notify(t('hrFix.resellers.discountRange'), 'error');
      return;
    }
    if (!(Number(flatPrice) >= 0)) {
      notify(t('hrFix.resellers.flatNumber'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch(
        endpoints.resellers.detail(r.customerId),
        {
          monthlyTargetQty: Number(target),
          discountPct: Number(discount),
          flatGallonPriceIdr: Number(flatPrice),
          note: note.trim() || null,
          // A bare date is midnight local; the server compares against `now`, so a date
          // typed as today is already in the past by the time it lands and means now.
          ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
        },
        true,
      );
      notify(effectiveAt ? t('hrFix.resellers.scheduled') : t('hrFix.resellers.updated'));
      setEditing(false);
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('hrFix.resellers.updateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setToggling(true);
    try {
      await api.patch(endpoints.resellers.detail(r.customerId), { active: !r.active }, true);
      notify(r.active ? t('hrFix.resellers.deactivated') : t('hrFix.resellers.reactivated'));
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('hrFix.resellers.statusFailed'), 'error');
    } finally {
      setToggling(false);
    }
  }

  if (editing) {
    return (
      <div className="p-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('hrFix.resellers.monthlyTarget')}>
            <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label={t('hrFix.resellers.discountShort')}>
            <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label={t('hrFix.resellers.flatPriceShort')} hint={t('hrFix.resellers.flatPriceShortHint')}>
            <Input type="number" value={flatPrice} onChange={(e) => setFlatPrice(e.target.value)} />
          </Field>
          <Field label={t('hrFix.resellers.noteOpt')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field
            label={t('hrFix.resellers.effectiveAt')}
            hint={t('hrFix.resellers.effectiveAtHint')}
            htmlFor={effectiveAtId}
          >
            <Input
              id={effectiveAtId}
              type="date"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
          </Field>
        </div>
        <PriceChangeHistory history={history} />
        <div className="mt-3 flex gap-2">
          <Button type="button" loading={saving} onClick={saveEdit}>
            {t('hrFix.resellers.save2')}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
            {t('hrFix.resellers.cancel2')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-4 p-4 text-sm ${r.active ? '' : 'opacity-60'}`}>
      <ResellerPhoto reseller={r} onChanged={onChanged} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{name ?? r.customerId}</div>
        <div className="text-muted">
          {roll?.volumeQty ?? 0} / {r.monthlyTargetQty} galon
          {/*
            J12: attainment counts every depot they took gallons from, because the target is
            theirs. The home depot's share is named only when the two differ — otherwise the
            line would carry a number that says nothing.
          */}
          {roll != null && roll.volumeAtDepotQty !== roll.volumeQty && (
            <> ({t('hrFix.resellers.atThisDepot', { n: roll.volumeAtDepotQty })})</>
          )}
          {m.attainmentPct != null && <> · {m.attainmentPct}%</>}
          {' · '}pertumbuhan {m.growthPct >= 0 ? '↑' : '↓'} {Math.abs(m.growthPct)}%
          {r.flatGallonPriceIdr > 0 ? (
            <> · Rp{r.flatGallonPriceIdr.toLocaleString('id-ID')}/galon</>
          ) : (
            r.discountPct > 0 && <> · diskon {r.discountPct}%</>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!r.active && <Badge tone="neutral">{t('hrFix.resellers.inactive')}</Badge>}
        {r.active && m.pasif && <Badge tone="danger">{t('hrFix.resellers.dormant')}</Badge>}
        <Badge
          tone={
            m.status === 'lampaui' || m.status === 'tercapai'
              ? 'success'
              : m.status === 'no-target'
                ? 'neutral'
                : 'danger'
          }
        >
          {RESELLER_STATUS_LABEL[m.status]}
        </Badge>
        <Button type="button" variant="secondary" onClick={openEdit} className="px-3 py-1.5 text-xs">
          {t('hrFix.resellers.edit2')}
        </Button>
        <Button
          type="button"
          variant={r.active ? 'danger' : 'secondary'}
          loading={toggling}
          onClick={toggleActive}
          className="px-3 py-1.5 text-xs"
        >
          {r.active ? t('hrFix.resellers.deactivate') : t('hrFix.resellers.activate')}
        </Button>
      </div>
    </div>
  );
}
