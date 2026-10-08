'use client';

import { useState } from 'react';
import { Tag as TagIcon } from '@phosphor-icons/react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { PromoRule, PromoRuleChannel, PromoRuleKind, PromoRulePayload } from '@/lib/types';

interface RuleForm {
  name: string;
  kind: PromoRuleKind;
  productId: string;
  categoryId: string;
  specialPrice: string;
  buyQty: string;
  getQty: string;
  shippingFeeOverride: string;
  validFrom: string;
  validUntil: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  minQty: string;
  maxQty: string;
  channels: PromoRuleChannel[];
  active: boolean;
}

const EMPTY: RuleForm = {
  name: '', kind: 'SPECIAL_PRICE', productId: '', categoryId: '',
  specialPrice: '', buyQty: '', getQty: '', shippingFeeOverride: '',
  validFrom: '', validUntil: '', daysOfWeek: [], startTime: '', endTime: '',
  minQty: '1', maxQty: '', channels: [], active: true,
};

function formFrom(r: PromoRule): RuleForm {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  return {
    name: r.name, kind: r.kind, productId: r.productId ?? '',
    categoryId: r.categoryId ?? '',
    specialPrice: r.specialPrice != null ? String(r.specialPrice) : '',
    buyQty: r.buyQty != null ? String(r.buyQty) : '',
    getQty: r.getQty != null ? String(r.getQty) : '',
    shippingFeeOverride: r.shippingFeeOverride != null ? String(r.shippingFeeOverride) : '',
    validFrom: day(r.validFrom), validUntil: day(r.validUntil),
    daysOfWeek: r.daysOfWeek, startTime: r.startTime ?? '', endTime: r.endTime ?? '',
    minQty: String(r.minQty), maxQty: r.maxQty != null ? String(r.maxQty) : '',
    channels: r.channels, active: r.active,
  };
}

/**
 * Editing an existing rule must preserve its OWN depotId (never the console's currently
 * active depot, which a multi-depot-scoped caller could have pointed anywhere) — only a
 * brand-new rule defaults to the active depot. Exported so this one branch, which already
 * regressed once (silently moving a rule between depots on save), has a test that doesn't
 * need to render the page.
 */
export function effectiveDepotIdFor(
  rule: PromoRule | null,
  activeDepotId: string | null,
): string | null {
  return rule ? rule.depotId : activeDepotId;
}

function toPayload(f: RuleForm, depotId: string | null): PromoRulePayload {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  const numOrNull = (s: string) => (s.trim() ? Number(s) : null);
  const dateOrNull = (s: string) => (s ? new Date(s).toISOString() : null);
  return {
    name: f.name.trim(),
    kind: f.kind,
    depotId,
    productId: orNull(f.productId),
    categoryId: orNull(f.categoryId),
    specialPrice: f.kind === 'SPECIAL_PRICE' ? numOrNull(f.specialPrice) : null,
    buyQty: f.kind === 'BUY_X_GET_Y' ? numOrNull(f.buyQty) : null,
    getQty: f.kind === 'BUY_X_GET_Y' ? numOrNull(f.getQty) : null,
    shippingFeeOverride: f.kind === 'SHIPPING_DISCOUNT' ? numOrNull(f.shippingFeeOverride) : null,
    validFrom: dateOrNull(f.validFrom),
    validUntil: dateOrNull(f.validUntil),
    daysOfWeek: f.daysOfWeek,
    startTime: orNull(f.startTime),
    endTime: orNull(f.endTime),
    minQty: Number(f.minQty) || 1,
    maxQty: numOrNull(f.maxQty),
    channels: f.channels,
    active: f.active,
  };
}

function KindFields({ form, set }: { form: RuleForm; set: (k: keyof RuleForm) => (e: { target: { value: string } }) => void }) {
  const { t } = useT();
  if (form.kind === 'SPECIAL_PRICE') {
    return (
      <Field label={t('dashboard.promoRules.fields.specialPrice')}>
        <Input type="number" value={form.specialPrice} onChange={set('specialPrice')} />
      </Field>
    );
  }
  if (form.kind === 'BUY_X_GET_Y') {
    return (
      <>
        <Field label={t('dashboard.promoRules.fields.buyQty')}>
          <Input type="number" value={form.buyQty} onChange={set('buyQty')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.getQty')}>
          <Input type="number" value={form.getQty} onChange={set('getQty')} />
        </Field>
      </>
    );
  }
  return (
    <Field label={t('dashboard.promoRules.fields.shippingFeeOverride')}>
      <Input type="number" value={form.shippingFeeOverride} onChange={set('shippingFeeOverride')} />
    </Field>
  );
}

function RuleEditor({
  activeDepotId,
  rule,
  onDone,
  onCancel,
}: {
  activeDepotId: string | null;
  rule: PromoRule | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<RuleForm>(rule ? formFrom(rule) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing an existing rule must never move it between depots: the effective depotId is
  // always the rule's own depotId (including null/network-wide), not whatever depot the
  // console's switcher currently has active. Only a brand-new rule defaults to the active depot.
  const effectiveDepotId = effectiveDepotIdFor(rule, activeDepotId);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dayLabels = t('dashboard.promoRules.days') as unknown as string[];

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day) ? f.daysOfWeek.filter((d) => d !== day) : [...f.daysOfWeek, day],
    }));
  }

  function toggleChannel(channel: PromoRuleChannel) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(channel) ? f.channels.filter((c) => c !== channel) : [...f.channels, channel],
    }));
  }

  async function submit() {
    if (!form.name.trim()) {
      setError(t('dashboard.promoRules.needName'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(form, effectiveDepotId);
      if (rule) {
        await api.patch(
          endpoints.promoRules.detail(rule.id),
          // CA-2-53: the version this edit started from; the server refuses (409) if it moved.
          { ...payload, seenUpdatedAt: rule.updatedAt },
          true,
        );
      } else {
        await api.post(endpoints.promoRules.create, payload, true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.promoRules.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{rule ? t('dashboard.promoRules.editorEdit') : t('dashboard.promoRules.editorNew')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('dashboard.promoRules.fields.name')}>
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.kind')}>
          <select
            className="w-full rounded-lg border border-app bg-surface px-3 py-2.5 text-sm"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PromoRuleKind }))}
          >
            <option value="SPECIAL_PRICE">{t('dashboard.promoRules.fields.kindSpecialPrice')}</option>
            <option value="BUY_X_GET_Y">{t('dashboard.promoRules.fields.kindBogo')}</option>
            <option value="SHIPPING_DISCOUNT">{t('dashboard.promoRules.fields.kindShipping')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.promoRules.fields.depotId')}>
          <Input value={effectiveDepotId ?? '—'} disabled />
        </Field>
        <Field label={t('dashboard.promoRules.fields.productId')}>
          <Input value={form.productId} onChange={set('productId')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.categoryId')} hint={t('dashboard.promoRules.fields.categoryIdHint')}>
          <Input value={form.categoryId} onChange={set('categoryId')} />
        </Field>
        <KindFields form={form} set={set} />
        <Field label={t('dashboard.promoRules.fields.validFrom')}>
          <Input type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.validUntil')}>
          <Input type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.startTime')}>
          <Input type="time" value={form.startTime} onChange={set('startTime')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.endTime')}>
          <Input type="time" value={form.endTime} onChange={set('endTime')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.minQty')}>
          <Input type="number" value={form.minQty} onChange={set('minQty')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.maxQty')}>
          <Input type="number" value={form.maxQty} onChange={set('maxQty')} />
        </Field>
        <Field label={t('dashboard.promoRules.fields.daysOfWeek')}>
          <div className="flex flex-wrap gap-2">
            {dayLabels.map((label, day) => (
              <label key={day} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('dashboard.promoRules.fields.channels')}>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('APP')} onChange={() => toggleChannel('APP')} />
              {t('dashboard.promoRules.fields.channelApp')}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('COUNTER')} onChange={() => toggleChannel('COUNTER')} />
              {t('dashboard.promoRules.fields.channelCounter')}
            </label>
          </div>
        </Field>
        {rule && (
          <Field label={t('dashboard.promoRules.fields.active')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              {t('dashboard.promoRules.fields.active')}
            </label>
          </Field>
        )}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {rule ? t('dashboard.promoRules.save') : t('dashboard.promoRules.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('dashboard.promoRules.cancel')}
        </Button>
      </div>
    </Card>
  );
}

export default function DashboardPromoRulesPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { selectedId: activeDepotId } = useDepot();
  const [editing, setEditing] = useState<PromoRule | null | undefined>(undefined);
  const { data, error, loading, reload } = useAsync<PromoRule[]>(
    () => api.get<PromoRule[]>(endpoints.promoRules.manage, true),
    [],
  );

  async function remove(id: string) {
    try {
      await api.del(endpoints.promoRules.detail(id), true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'error');
    }
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TagIcon size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashboard.promoRules.title')}</h1>
            <p className="text-sm text-muted">{t('dashboard.promoRules.subtitle')}</p>
          </div>
        </div>
        {editing === undefined && <Button onClick={() => setEditing(null)}>{t('dashboard.promoRules.newRule')}</Button>}
      </div>

      {editing !== undefined && (
        <RuleEditor
          activeDepotId={activeDepotId}
          rule={editing}
          onCancel={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <CenterState icon={<TagIcon size={48} weight="thin" />} title={t('dashboard.promoRules.empty')} />
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {data.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{r.name}</span>
                  <Badge tone="neutral">{r.kind}</Badge>
                  <Badge tone={r.active ? 'success' : 'neutral'}>
                    {r.active ? t('dashboard.promoRules.active') : t('dashboard.promoRules.inactive')}
                  </Badge>
                </span>
                <span className="truncate text-sm text-muted">
                  {r.depotId ?? '—'} · {r.productId ?? r.categoryId ?? '—'}
                </span>
              </div>
              <Button variant="ghost" onClick={() => setEditing(r)}>
                {t('dashboard.promoRules.edit')}
              </Button>
              <Button variant="danger" onClick={() => remove(r.id)}>
                {t('dashboard.promoRules.remove')}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
