'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Tag as TagIcon } from '@phosphor-icons/react';

import { CategorySelect, DepotSelect, ProductSelect, useProductList } from '@/components/catalog-select';
import { useConfirm } from '@/components/confirm';
import { PromoFirstOrderField, PromoKindFields, PromoKindSelect, KIND_KEY } from '@/components/promo-rule-kind-fields';
import { PromoSimulator, RuleFilterBar, RuleUsageLine, useRuleUsage } from '@/components/promo-rule-tools';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { effectiveDepotIdFor } from '@/lib/promo-rule-depot';
import { EMPTY_RULE_FILTER, duplicateRule, filterRules } from '@/lib/promo-rule-filter';
import { EMPTY_RULE_FORM, type RuleForm, isOrderLevelKind, ruleFormFrom, ruleFormToPayload, validateRuleForm } from '@/lib/promo-rule-form';
import { canWritePromoRule, canWritePromoRules } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Category, PromoRule, PromoRuleChannel } from '@/lib/types';

/**
 * The promo-rule console — /hq/promo-rules and /dashboard/promo-rules are this one component.
 *
 * They were two copies of the same 300 lines with two copies of the same 64 strings
 * (`hq.promoRules.*` and `dashboard.promoRules.*`, differing in one label), and they drifted in
 * the small ways copies do: the depot console's editor showed its depot as a raw UUID in a box
 * labelled "Depot (ID)", and both lists printed depot, product and category UUIDs and the kind as
 * its enum name. What genuinely differs is only where a rule may live:
 *
 *   network — head office picks any depot, or none for the whole network;
 *   depot   — a new rule belongs to the depot being worked in, and an existing rule keeps its
 *             own depot whatever the console points at (see `effectiveDepotIdFor`).
 */
export type PromoRulesScope =
  | { mode: 'network' }
  | {
      mode: 'depot';
      /** The depot a NEW rule is created for: the console's working depot. */
      activeDepotId: string | null;
    };

function RuleEditor({
  scope,
  depotName,
  rule,
  template,
  onDone,
  onCancel,
}: {
  scope: PromoRulesScope;
  depotName: (id: string) => string | undefined;
  rule: PromoRule | null;
  template?: PromoRule | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const T = (k: string) => t(`hq.promoRules.${k}`);
  const [form, setForm] = useState<RuleForm>(
    rule ? ruleFormFrom(rule) : template ? ruleFormFrom(template) : EMPTY_RULE_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((day) => T(`days.${day}`));
  // Where the rule lives. In a depot console: a new rule is the working depot's, an existing one
  // keeps its own. Head office chooses in the form.
  const fixedDepotId =
    scope.mode === 'depot' ? effectiveDepotIdFor(rule, scope.activeDepotId) : undefined;

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
      setError(T(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const depotId = fixedDepotId !== undefined ? fixedDepotId : form.depotId.trim() || null;
      const payload = ruleFormToPayload(form, depotId, rule ? 'edit' : 'create');
      if (rule) {
        await api.patch(endpoints.promoRules.detail(rule.id), { ...payload, seenUpdatedAt: rule.updatedAt }, true);
      } else {
        await api.post(endpoints.promoRules.create, payload, true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : T('saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{rule ? T('editorEdit') : T('editorNew')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={T('fields.name')}>
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <PromoKindSelect form={form} setForm={setForm} />
        {fixedDepotId !== undefined ? (
          // The depot it lives in, by NAME — this box used to show the raw UUID.
          <Field label={T('fields.depotId')}>
            <Input
              value={fixedDepotId ? (depotName(fixedDepotId) ?? fixedDepotId) : T('fields.anyDepot')}
              disabled
            />
          </Field>
        ) : (
          <Field label={T('fields.depotId')} hint={T('fields.depotIdHint')}>
            <DepotSelect
              value={form.depotId}
              onChange={(v) => setForm((f) => ({ ...f, depotId: v }))}
              emptyLabel={T('fields.anyDepot')}
            />
          </Field>
        )}
        {!isOrderLevelKind(form.kind) && (
          <>
            <Field label={T('fields.productId')}>
              <ProductSelect
                value={form.productId}
                onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
                emptyLabel={T('fields.anyProduct')}
              />
            </Field>
            <Field label={T('fields.categoryId')} hint={T('fields.categoryIdHint')}>
              <CategorySelect
                value={form.categoryId}
                onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                emptyLabel={T('fields.anyCategory')}
              />
            </Field>
          </>
        )}
        <PromoKindFields form={form} setForm={setForm} />
        <PromoFirstOrderField form={form} setForm={setForm} />
        <Field label={T('fields.validFrom')}>
          <Input type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={T('fields.validUntil')}>
          <Input type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
        <Field label={T('fields.startTime')}>
          <Input type="time" value={form.startTime} onChange={set('startTime')} />
        </Field>
        <Field label={T('fields.endTime')}>
          <Input type="time" value={form.endTime} onChange={set('endTime')} />
        </Field>
        {!isOrderLevelKind(form.kind) && (
          <>
            <Field label={T('fields.minQty')}>
              <Input type="number" value={form.minQty} onChange={set('minQty')} />
            </Field>
            <Field label={T('fields.maxQty')}>
              <Input type="number" value={form.maxQty} onChange={set('maxQty')} />
            </Field>
          </>
        )}
        <Field label={T('fields.daysOfWeek')}>
          <div className="flex flex-wrap gap-2">
            {dayLabels.map((label, day) => (
              <label key={day} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label={T('fields.channels')}>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('APP')} onChange={() => toggleChannel('APP')} />
              {T('fields.channelApp')}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.channels.includes('COUNTER')} onChange={() => toggleChannel('COUNTER')} />
              {T('fields.channelCounter')}
            </label>
          </div>
        </Field>
        {rule && (
          <Field label={T('fields.active')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              {T('fields.active')}
            </label>
          </Field>
        )}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {rule ? T('save') : T('create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {T('cancel')}
        </Button>
      </div>
    </Card>
  );
}

export function PromoRulesAdmin({
  scope,
  depotName,
  header,
}: {
  scope: PromoRulesScope;
  /** A depot's name, from whatever list the console already holds; undefined when unknown. */
  depotName: (id: string) => string | undefined;
  /** The page's own heading, given the "new rule" button to place. */
  header: (action: ReactNode) => ReactNode;
}) {
  const { t } = useT();
  const T = (k: string) => t(`hq.promoRules.${k}`);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const role = useAuth().customer?.role;
  const [editing, setEditing] = useState<PromoRule | null | undefined>(undefined);
  const [template, setTemplate] = useState<PromoRule | null>(null);
  const [filter, setFilter] = useState(EMPTY_RULE_FILTER);
  const usages = useRuleUsage();
  const { data, error, loading, reload } = useAsync<PromoRule[]>(
    () => api.get<PromoRule[]>(endpoints.promoRules.manage, true),
    [],
  );
  // Names for the rows. A failed read only costs the names: the row falls back to the id.
  const products = useProductList();
  const categories = useAsync<Category[]>(() => api.get<Category[]>(endpoints.products.categories), []);
  const productName = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p.name])), [products.data]);
  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );
  const visible = filterRules(data ?? [], filter);
  const where = (r: PromoRule) => (r.depotId ? (depotName(r.depotId) ?? r.depotId) : T('fields.anyDepot'));
  const what = (r: PromoRule) =>
    r.productId
      ? (productName.get(r.productId) ?? r.productId)
      : r.categoryId
        ? (categoryName.get(r.categoryId) ?? r.categoryId)
        : T('fields.anyProduct');

  async function remove(id: string) {
    if (
      !(await confirm({
        title: t('hrFix.confirmGap.deleteTitle'),
        message: t('hrFix.confirmGap.deleteMessage'),
        confirmLabel: t('hrFix.confirmGap.deleteConfirm'),
        tone: 'danger',
      }))
    )
      return;
    try {
      await api.del(endpoints.promoRules.detail(id), true);
    } catch (e) {
      // A refused delete (the rule is in use) must say so; the list then shows it still there.
      toast(e instanceof ApiError ? e.message : t('hq.common.actionFailed'), 'error');
    }
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      {header(
        editing === undefined && canWritePromoRules(role) ? (
          <Button onClick={() => setEditing(null)}>{T('newRule')}</Button>
        ) : null,
      )}

      <PromoSimulator rules={data ?? []} fixedDepotId={scope.mode === 'depot' ? scope.activeDepotId : undefined} />

      {editing !== undefined && (
        <RuleEditor
          scope={scope}
          depotName={depotName}
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
        <CenterState icon={<TagIcon size={48} weight="thin" />} title={T('empty')} />
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
                      <Badge tone="neutral">{T(`fields.${KIND_KEY[r.kind]}`)}</Badge>
                      <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? T('active') : T('inactive')}</Badge>
                    </span>
                    {/* Where and on what, by name: these used to be the UUIDs themselves. */}
                    <span className="truncate text-sm text-muted">
                      {where(r)} · {what(r)}
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
                        {T('edit')}
                      </Button>
                      <Button variant="danger" onClick={() => remove(r.id)}>
                        {T('remove')}
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
