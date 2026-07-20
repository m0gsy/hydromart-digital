'use client';

import { useState } from 'react';
import { Lock, Tag } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT, type TVars } from '@/lib/locale-context';
import { canManagePricing } from '@/lib/roles';
import { EMPTY_RULE_FORM, computeEffective, toRulePayload, type RuleForm } from '@/lib/pricing';
import { useAsync } from '@/lib/use-async';
import type { Page, PricingRule, Product, ResolvedPrice } from '@/lib/types';

// Indonesian day abbreviations — consistent with the mobile operator app.
const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

type T = (key: string, vars?: TVars) => string;

/** Minutes-since-midnight -> "HH:MM", or '' for null (all day). */
function minutesToHHMM(m: number | null): string {
  if (m == null) return '';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function formFromRule(r: PricingRule): RuleForm {
  return {
    productId: r.productId ?? '',
    adjustType: r.adjustType,
    value: String(r.value),
    daysOfWeek: r.daysOfWeek,
    startTime: minutesToHHMM(r.startMinute),
    endTime: minutesToHHMM(r.endMinute),
    validFrom: r.validFrom ?? '',
    validUntil: r.validUntil ?? '',
    priority: String(r.priority),
    active: r.active,
  };
}

function adjustmentLabel(r: PricingRule): string {
  return r.adjustType === 'PERCENT' ? `${r.value}%` : formatIDR(r.value);
}

function windowSummary(r: PricingRule, t: T): string {
  const days = r.daysOfWeek.length === 0 ? t('dashboard.pricing.everyDay') : r.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ');
  const time =
    r.startMinute == null && r.endMinute == null
      ? t('dashboard.pricing.allDay')
      : `${minutesToHHMM(r.startMinute) || '00:00'}–${minutesToHHMM(r.endMinute) || '24:00'}`;
  const window = `${days} · ${time}`;
  if (!r.validFrom && !r.validUntil) return window;
  return `${window} · ${r.validFrom ?? '…'} – ${r.validUntil ?? '…'}`;
}

/** Create (rule=null) or edit form. */
function RuleEditor({
  depotId,
  rule,
  onDone,
  onCancel,
}: {
  depotId: string;
  rule: PricingRule | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<RuleForm>(rule ? formFromRule(rule) : EMPTY_RULE_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day) ? f.daysOfWeek.filter((d) => d !== day) : [...f.daysOfWeek, day],
    }));
  }

  async function submit() {
    const parsed = toRulePayload(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (rule) await api.patch(endpoints.pricing.detail(depotId, rule.id), parsed.value, true);
      else await api.post(endpoints.pricing.create(depotId), parsed.value, true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.pricing.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{rule ? t('dashboard.pricing.editTitle') : t('dashboard.pricing.newTitle')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dashboard.pricing.productLabel')} htmlFor="r-product" hint={t('dashboard.pricing.productHint')}>
          <Input id="r-product" value={form.productId} onChange={set('productId')} placeholder={t('dashboard.pricing.productPlaceholder')} />
        </Field>
        <Field label={t('dashboard.pricing.adjustTypeLabel')} htmlFor="r-type">
          <select
            id="r-type"
            value={form.adjustType}
            onChange={set('adjustType')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
          >
            <option value="PERCENT">{t('dashboard.pricing.percent')}</option>
            <option value="FIXED">{t('dashboard.pricing.fixed')}</option>
          </select>
        </Field>
        <Field
          label={t('dashboard.pricing.valueLabel')}
          htmlFor="r-value"
          hint={form.adjustType === 'PERCENT' ? t('dashboard.pricing.valueHintPercent') : t('dashboard.pricing.valueHintFixed')}
        >
          <Input id="r-value" inputMode="decimal" value={form.value} onChange={set('value')} placeholder="-10" />
        </Field>
        <Field label={t('dashboard.pricing.priorityLabel')} htmlFor="r-priority" hint={t('dashboard.pricing.priorityHint')}>
          <Input id="r-priority" inputMode="numeric" value={form.priority} onChange={set('priority')} placeholder="0" />
        </Field>
        <Field label={t('dashboard.pricing.startTimeLabel')} htmlFor="r-start" hint={t('dashboard.pricing.startTimeHint')}>
          <Input id="r-start" type="time" value={form.startTime} onChange={set('startTime')} />
        </Field>
        <Field label={t('dashboard.pricing.endTimeLabel')} htmlFor="r-end" hint={t('dashboard.pricing.endTimeHint')}>
          <Input id="r-end" type="time" value={form.endTime} onChange={set('endTime')} />
        </Field>
        <Field label={t('dashboard.pricing.validFromLabel')} htmlFor="r-from" hint={t('dashboard.pricing.validFromHint')}>
          <Input id="r-from" type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={t('dashboard.pricing.validUntilLabel')} htmlFor="r-until" hint={t('dashboard.pricing.validUntilHint')}>
          <Input id="r-until" type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">{t('dashboard.pricing.daysOfWeek')}</p>
        <div className="flex flex-wrap gap-3">
          {DAY_LABELS.map((label, day) => (
            <label key={day} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{t('dashboard.pricing.noneEveryDay')}</p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
        />
        {t('dashboard.pricing.active')}
      </label>

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashboard.pricing.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {rule ? t('dashboard.pricing.saveChanges') : t('dashboard.pricing.createRule')}
        </Button>
      </div>
    </Card>
  );
}

function RuleCard({
  rule,
  depotId,
  onEdit,
  onChanged,
}: {
  rule: PricingRule;
  depotId: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(t('dashboard.pricing.deleteConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.pricing.detail(depotId, rule.id), true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.pricing.deleteError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{rule.productId ?? t('dashboard.pricing.allProducts')}</p>
          <p className="text-xs text-muted">{windowSummary(rule, t)}</p>
        </div>
        <Badge tone={rule.active ? 'success' : 'neutral'}>{rule.active ? t('dashboard.pricing.active') : t('dashboard.pricing.inactive')}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">{t('dashboard.pricing.adjustment')}</dt>
          <dd className="font-semibold tabular-nums">{adjustmentLabel(rule)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('dashboard.pricing.priorityLabel')}</dt>
          <dd className="font-semibold tabular-nums">{rule.priority}</dd>
        </div>
      </dl>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-app pt-2">
        <Button variant="secondary" onClick={onEdit} disabled={busy}>
          {t('dashboard.pricing.edit')}
        </Button>
        <Button variant="danger" onClick={remove} loading={busy}>
          {t('dashboard.pricing.delete')}
        </Button>
      </div>
    </Card>
  );
}

const adjustNote = (r: ResolvedPrice): string => {
  if (!r.adjustType) return '—';
  const v = r.value ?? 0;
  return r.adjustType === 'PERCENT' ? `${v > 0 ? '+' : ''}${v}%` : `${v > 0 ? '+' : ''}${formatIDR(v)}`;
};

/**
 * Effective-price preview (11a): every catalog product's resolved price at this depot
 * — override + winning active rule — so staff see the final price a customer pays now.
 */
function EffectivePreview({ depotId }: { depotId: string }) {
  const { t } = useT();
  const catalog = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 100 })), [depotId]);
  const ids = (catalog.data?.items ?? []).map((p) => p.id);
  const resolved = useAsync<ResolvedPrice[]>(
    () => (ids.length ? api.get(endpoints.inventory.prices(depotId, ids)) : Promise.resolve([])),
    [depotId, ids.join(',')],
  );

  if (catalog.loading) return <Skeleton className="h-48 w-full" />;
  if (catalog.error) return <ErrorState message={catalog.error} onRetry={catalog.reload} />;
  const products = catalog.data?.items ?? [];
  if (products.length === 0)
    return <p className="text-sm text-muted">{t('dashboard.pricing.noProducts')}</p>;

  const byId = new Map((resolved.data ?? []).map((r) => [r.productId, r]));

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-app text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-medium">{t('dashboard.pricing.colProduct')}</th>
            <th className="px-4 py-2.5 text-right font-medium">{t('dashboard.pricing.colBase')}</th>
            <th className="px-4 py-2.5 text-right font-medium">{t('dashboard.pricing.colOverride')}</th>
            <th className="px-4 py-2.5 text-right font-medium">{t('dashboard.pricing.colRule')}</th>
            <th className="px-4 py-2.5 text-right font-medium">{t('dashboard.pricing.colEffective')}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const r = byId.get(p.id);
            const eff = computeEffective(p.basePrice, r);
            const changed = eff.effective !== p.basePrice;
            return (
              <tr key={p.id} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted">{p.sku}</p>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  <Money amount={p.basePrice} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {eff.override != null ? <Money amount={eff.override} /> : '—'}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r ? adjustNote(r) : '—'}</td>
                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${changed ? 'text-brand-700' : ''}`}>
                  <Money amount={eff.effective} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function PricingBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const depotId = scopedId ?? '';
  const [editing, setEditing] = useState<PricingRule | null | 'new'>(null);
  const [preview, setPreview] = useState(false);

  const rules = useAsync<PricingRule[]>(
    () => (depotId ? api.get(endpoints.pricing.rules(depotId), true) : Promise.resolve([])),
    [depotId],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === depotId) ?? null;

  function closeForm() {
    setEditing(null);
    rules.reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tag size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashboard.pricing.title')}</h1>
        </div>
        {depotId && editing === null && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPreview((v) => !v)}>
              {preview ? t('dashboard.pricing.previewClose') : t('dashboard.pricing.previewOpen')}
            </Button>
            <Button onClick={() => setEditing('new')}>{t('dashboard.pricing.newRule')}</Button>
          </div>
        )}
      </div>

      {preview && depotId && <EffectivePreview depotId={depotId} />}

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          {t('dashboard.pricing.scopedBefore')}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>
          {t('dashboard.pricing.scopedAfter')}
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashboard.pricing.noDepots')} icon={<Tag size={40} weight="fill" />}>
          {t('dashboard.pricing.noDepotsBody')}
        </CenterState>
      ) : (
        <>
          {editing !== null && depotId && (
            <RuleEditor
              key={editing === 'new' ? 'new' : editing.id}
              depotId={depotId}
              rule={editing === 'new' ? null : editing}
              onDone={closeForm}
              onCancel={() => setEditing(null)}
            />
          )}

          {rules.loading ? (
            <Skeleton className="h-64 w-full" />
          ) : rules.error ? (
            <ErrorState message={rules.error} onRetry={rules.reload} />
          ) : !rules.data || rules.data.length === 0 ? (
            <CenterState title={t('dashboard.pricing.noRules')} icon={<Tag size={40} weight="fill" />}>
              {t('dashboard.pricing.noRulesBody')}
            </CenterState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {rules.data.map((r) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  depotId={depotId}
                  onEdit={() => setEditing(r)}
                  onChanged={rules.reload}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManagePricing(customer?.role)) {
    return (
      <CenterState title={t('dashboard.pricing.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashboard.pricing.gateBody')}
      </CenterState>
    );
  }
  return <PricingBody />;
}

export default function PricingPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
