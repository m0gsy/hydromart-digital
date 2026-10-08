'use client';

import { useState } from 'react';
import { Tag as TagIcon } from '@phosphor-icons/react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { CategorySelect, ProductSelect } from '@/components/catalog-select';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canWritePromoRule, canWritePromoRules } from '@/lib/roles';
import { effectiveDepotIdFor } from '@/lib/promo-rule-depot';
import { PromoSimulator, RuleFilterBar, RuleUsageLine, useRuleUsage } from '@/components/promo-rule-tools';
import { EMPTY_RULE_FILTER, duplicateRule, filterRules } from '@/lib/promo-rule-filter';
import { useAsync } from '@/lib/use-async';
import { PromoFirstOrderField, PromoKindFields, PromoKindSelect } from '@/components/promo-rule-kind-fields';
import { EMPTY_RULE_FORM, type RuleForm, isOrderLevelKind, ruleFormFrom, ruleFormToPayload, validateRuleForm } from '@/lib/promo-rule-form';
import type { PromoRule, PromoRuleChannel } from '@/lib/types';

function RuleEditor({
  activeDepotId,
  rule,
  template,
  onDone,
  onCancel,
}: {
  activeDepotId: string | null;
  rule: PromoRule | null;
  /** A copy to start a NEW rule from (duplicate); ignored when editing. */
  template?: PromoRule | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<RuleForm>(
    rule ? ruleFormFrom(rule) : template ? ruleFormFrom(template) : EMPTY_RULE_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing an existing rule must never move it between depots: the effective depotId is
  // always the rule's own depotId (including null/network-wide), not whatever depot the
  // console's switcher currently has active. Only a brand-new rule defaults to the active depot.
  const effectiveDepotId = effectiveDepotIdFor(rule, activeDepotId);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Per-day string keys: t() only returns string leaves (a non-string value comes back as the
  // key itself), so the weekday names are an object keyed 0-6, not an array.
  const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((day) => t(`dashboard.promoRules.days.${day}`));

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
    const problem = validateRuleForm(form);
    if (problem) {
      setError(t(`dashboard.promoRules.${problem}`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = ruleFormToPayload(form, effectiveDepotId);
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
        <PromoKindSelect ns="dashboard" form={form} setForm={setForm} />
        <Field label={t('dashboard.promoRules.fields.depotId')}>
          <Input value={effectiveDepotId ?? '—'} disabled />
        </Field>
        {!isOrderLevelKind(form.kind) && (
          <>
            <Field label={t('dashboard.promoRules.fields.productId')}>
              <ProductSelect
                value={form.productId}
                onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
                emptyLabel={t('dashboard.promoRules.fields.anyProduct')}
              />
            </Field>
            <Field label={t('dashboard.promoRules.fields.categoryId')} hint={t('dashboard.promoRules.fields.categoryIdHint')}>
              <CategorySelect
                value={form.categoryId}
                onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                emptyLabel={t('dashboard.promoRules.fields.anyCategory')}
              />
            </Field>
          </>
        )}
        <PromoKindFields ns="dashboard" form={form} setForm={setForm} />
        <PromoFirstOrderField ns="dashboard" form={form} setForm={setForm} />
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
        {!isOrderLevelKind(form.kind) && (
          <>
            <Field label={t('dashboard.promoRules.fields.minQty')}>
              <Input type="number" value={form.minQty} onChange={set('minQty')} />
            </Field>
            <Field label={t('dashboard.promoRules.fields.maxQty')}>
              <Input type="number" value={form.maxQty} onChange={set('maxQty')} />
            </Field>
          </>
        )}
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
  const role = useAuth().customer?.role;
  const [editing, setEditing] = useState<PromoRule | null | undefined>(undefined);
  const [template, setTemplate] = useState<PromoRule | null>(null);
  const [filter, setFilter] = useState(EMPTY_RULE_FILTER);
  const usages = useRuleUsage();
  const { data, error, loading, reload } = useAsync<PromoRule[]>(
    () => api.get<PromoRule[]>(endpoints.promoRules.manage, true),
    [],
  );

  const visible = filterRules(data ?? [], filter);

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
        {editing === undefined && canWritePromoRules(role) && <Button onClick={() => setEditing(null)}>{t('dashboard.promoRules.newRule')}</Button>}
      </div>

      <PromoSimulator rules={data ?? []} fixedDepotId={activeDepotId} />

      {editing !== undefined && (
        <RuleEditor
          activeDepotId={activeDepotId}
          rule={editing}
          template={template}
          onCancel={() => {
            setEditing(undefined);
            setTemplate(null);
          }}
          onDone={() => {
            setEditing(undefined);
            setTemplate(null);
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
        <>
        <RuleFilterBar value={filter} onChange={setFilter} />
        {visible.length === 0 ? (
          <CenterState icon={<TagIcon size={48} weight="thin" />} title={t('hq.promoTools.noMatch')} />
        ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {visible.map((r) => (
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
                <RuleUsageLine usages={usages} ruleId={r.id} />
              </div>
              {canWritePromoRule(role, r) && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setTemplate(duplicateRule(r, t('hq.promoTools.copySuffix')));
                      setEditing(null);
                    }}
                  >
                    {t('hq.promoTools.duplicate')}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(r)}>
                    {t('dashboard.promoRules.edit')}
                  </Button>
                  <Button variant="danger" onClick={() => remove(r.id)}>
                    {t('dashboard.promoRules.remove')}
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
        )}
        </>
      )}
    </div>
  );
}
