'use client';

import { useState } from 'react';
import { Tag as TagIcon } from '@phosphor-icons/react';

import { CategorySelect, DepotSelect, ProductSelect } from '@/components/catalog-select';
import { HqPageHeader } from '@/components/hq/page-header';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canWritePromoRule, canWritePromoRules } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { PromoFirstOrderField, PromoKindFields, PromoKindSelect } from '@/components/promo-rule-kind-fields';
import { EMPTY_RULE_FORM, type RuleForm, isOrderLevelKind, ruleFormFrom, ruleFormToPayload, validateRuleForm } from '@/lib/promo-rule-form';
import type { PromoRule, PromoRuleChannel } from '@/lib/types';

function RuleEditor({ rule, onDone, onCancel }: { rule: PromoRule | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState<RuleForm>(rule ? ruleFormFrom(rule) : EMPTY_RULE_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Per-day string keys: t() only returns string leaves (a non-string value comes back as the
  // key itself), so the weekday names are an object keyed 0-6, not an array.
  const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((day) => t(`hq.promoRules.days.${day}`));

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
      setError(t(`hq.promoRules.${problem}`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = ruleFormToPayload(form, form.depotId.trim() || null);
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
      setError(err instanceof ApiError ? err.message : t('hq.promoRules.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{rule ? t('hq.promoRules.editorEdit') : t('hq.promoRules.editorNew')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hq.promoRules.fields.name')}>
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <PromoKindSelect ns="hq" form={form} setForm={setForm} />
        <Field label={t('hq.promoRules.fields.depotId')} hint={t('hq.promoRules.fields.depotIdHint')}>
          <DepotSelect
            value={form.depotId}
            onChange={(v) => setForm((f) => ({ ...f, depotId: v }))}
            emptyLabel={t('hq.promoRules.fields.anyDepot')}
          />
        </Field>
        {!isOrderLevelKind(form.kind) && (
          <>
            <Field label={t('hq.promoRules.fields.productId')}>
              <ProductSelect
                value={form.productId}
                onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
                emptyLabel={t('hq.promoRules.fields.anyProduct')}
              />
            </Field>
            <Field label={t('hq.promoRules.fields.categoryId')} hint={t('hq.promoRules.fields.categoryIdHint')}>
              <CategorySelect
                value={form.categoryId}
                onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                emptyLabel={t('hq.promoRules.fields.anyCategory')}
              />
            </Field>
          </>
        )}
        <PromoKindFields ns="hq" form={form} setForm={setForm} />
        <PromoFirstOrderField ns="hq" form={form} setForm={setForm} />
        <Field label={t('hq.promoRules.fields.validFrom')}>
          <Input type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={t('hq.promoRules.fields.validUntil')}>
          <Input type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
        <Field label={t('hq.promoRules.fields.startTime')}>
          <Input type="time" value={form.startTime} onChange={set('startTime')} />
        </Field>
        <Field label={t('hq.promoRules.fields.endTime')}>
          <Input type="time" value={form.endTime} onChange={set('endTime')} />
        </Field>
        {!isOrderLevelKind(form.kind) && (
          <>
            <Field label={t('hq.promoRules.fields.minQty')}>
              <Input type="number" value={form.minQty} onChange={set('minQty')} />
            </Field>
            <Field label={t('hq.promoRules.fields.maxQty')}>
              <Input type="number" value={form.maxQty} onChange={set('maxQty')} />
            </Field>
          </>
        )}
        <Field label={t('hq.promoRules.fields.daysOfWeek')}>
          <div className="flex flex-wrap gap-2">
            {dayLabels.map((label, day) => (
              <label key={day} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('hq.promoRules.fields.channels')}>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('APP')} onChange={() => toggleChannel('APP')} />
              {t('hq.promoRules.fields.channelApp')}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('COUNTER')} onChange={() => toggleChannel('COUNTER')} />
              {t('hq.promoRules.fields.channelCounter')}
            </label>
          </div>
        </Field>
        {rule && (
          <Field label={t('hq.promoRules.fields.active')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              {t('hq.promoRules.fields.active')}
            </label>
          </Field>
        )}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {rule ? t('hq.promoRules.save') : t('hq.promoRules.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('hq.promoRules.cancel')}
        </Button>
      </div>
    </Card>
  );
}

export default function HqPromoRulesPage() {
  const { t } = useT();
  const { toast } = useToast();
  const role = useAuth().customer?.role;
  const [editing, setEditing] = useState<PromoRule | null | undefined>(undefined);
  const { data, error, loading, reload } = useAsync<PromoRule[]>(
    () => api.get<PromoRule[]>(endpoints.promoRules.manage, true),
    [],
  );

  async function remove(id: string) {
    try {
      await api.del(endpoints.promoRules.detail(id), true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hq.common.actionFailed'), 'error');
    }
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={TagIcon}
        title={t('hq.promoRules.title')}
        subtitle={t('hq.promoRules.subtitle')}
        action={
          <>
            {editing === undefined && canWritePromoRules(role) && <Button onClick={() => setEditing(null)}>{t('hq.promoRules.newRule')}</Button>}
          </>
        }
      />

      {editing !== undefined && (
        <RuleEditor
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
        <CenterState icon={<TagIcon size={48} weight="thin" />} title={t('hq.promoRules.empty')} />
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {data.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{r.name}</span>
                  <Badge tone="neutral">{r.kind}</Badge>
                  <Badge tone={r.active ? 'success' : 'neutral'}>
                    {r.active ? t('hq.promoRules.active') : t('hq.promoRules.inactive')}
                  </Badge>
                </span>
                <span className="truncate text-sm text-muted">
                  {r.depotId ?? '—'} · {r.productId ?? r.categoryId ?? '—'}
                </span>
              </div>
              {canWritePromoRule(role, r) && (
                <>
                  <Button variant="ghost" onClick={() => setEditing(r)}>
                    {t('hq.promoRules.edit')}
                  </Button>
                  <Button variant="danger" onClick={() => remove(r.id)}>
                    {t('hq.promoRules.remove')}
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
