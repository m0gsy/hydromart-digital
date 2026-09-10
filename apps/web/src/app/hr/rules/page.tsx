'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadError,
  Money,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import {
  BONUS_METRIC_LABEL,
  BONUS_TYPE_LABEL,
  BONUS_TYPES,
  COMPARE_OP_LABEL,
  REWARD_KIND_LABEL,
  type BonusMetric,
  type BonusRule,
  type BonusType,
  type CompareOp,
  type RewardKind,
} from '@/lib/hr';
import { formatIDR } from '@/lib/format';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

interface DepotOption {
  id: string;
  name: string;
}

const METRICS = Object.keys(BONUS_METRIC_LABEL) as BonusMetric[];
const OPS = Object.keys(COMPARE_OP_LABEL) as CompareOp[];
const KINDS = Object.keys(REWARD_KIND_LABEL) as RewardKind[];

/**
 * CA-1-60 — the threshold, in whatever the metric is actually counted in.
 *
 * It printed as a bare number, so "SALES_TOTAL ≥ 5000000" sat in a list of money rules
 * looking like five million of nothing, and "ATTENDANCE_RATE ≥ 95" looked like 95 of the
 * same nothing. Three metrics, three units: rupiah, per cent, days.
 */
function thresholdLabel(metric: BonusMetric, threshold: number | string): string {
  const n = Number(threshold);
  if (metric === 'SALES_TOTAL') return formatIDR(n);
  if (metric === 'ATTENDANCE_RATE') return `${n}%`;
  return String(n);
}

const EMPTY = {
  depotId: '',
  bonusType: 'ATTENDANCE' as BonusType,
  name: '',
  metric: 'ATTENDANCE_RATE' as BonusMetric,
  op: 'GTE' as CompareOp,
  threshold: '',
  rewardKind: 'FIXED' as RewardKind,
  rewardValue: '',
};

function RulesBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const admin = canManageHr(customer?.role);
  const { toast: notify } = useToast();
  const [form, setForm] = useState(EMPTY);
  /*
   * CA-1-22 — `PATCH /bonus-rules/:id` accepts all eight fields; this screen only ever
   * sent `active`. So a rule with the wrong threshold, the wrong metric or a typo in its
   * name could not be corrected: the only route out was to deactivate it and create a
   * second one, which leaves two rules with almost the same name in a list that decides
   * money, and no record that one replaced the other.
   *
   * The same form does both. `editing` holds the id being changed, or null for a new rule.
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rules = useAsync<BonusRule[]>(
    () => api.get<BonusRule[]>(endpoints.hr.bonusRules(), true),
    [],
  );
  const depots = useAsync<{ items: DepotOption[] }>(
    () => api.get<{ items: DepotOption[] }>(endpoints.depots.browse({ limit: 100 }), true),
    [],
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim()) return setErr(t('hrFix.rules.nameRequired'));
    const threshold = Number(form.threshold);
    const rewardValue = Number(form.rewardValue);
    if (!(threshold >= 0)) return setErr(t('hrFix.rules.thresholdInvalid'));
    if (!(rewardValue >= 0)) return setErr(t('hrFix.rules.rewardInvalid'));
    setSaving(true);
    const body = {
      bonusType: form.bonusType,
      name: form.name.trim(),
      metric: form.metric,
      op: form.op,
      threshold,
      rewardKind: form.rewardKind,
      rewardValue,
    };
    try {
      if (editing) {
        // `depotId` is deliberately not in the patch: which depot a rule belongs to is
        // what makes it a different rule, and moving one silently would re-target money
        // already reasoned about. Deactivate and create for that.
        await api.patch(
          endpoints.hr.updateBonusRule(editing),
          // CA-2-53: the version this edit started from; the server refuses (409) if it moved.
          { ...body, seenUpdatedAt: (rules.data ?? []).find((r) => r.id === editing)?.updatedAt },
          true,
        );
        notify(t('hrFix.rules.updated'));
      } else {
        await api.post(
          endpoints.hr.createBonusRule,
          { ...(form.depotId ? { depotId: form.depotId } : {}), ...body },
          true,
        );
        notify(t('hrFix.rules.added'));
      }
      setForm(EMPTY);
      setEditing(null);
      rules.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('hrFix.rules.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: BonusRule) {
    try {
      await api.patch(endpoints.hr.updateBonusRule(r.id), { active: !r.active }, true);
      rules.reload();
    } catch {
      // Same trap as employee-loans: `toast()` defaults to 'success', so this failure
      // used to render green with a tick.
      notify(t('hrFix.rules.toggleFailed'), 'error');
    }
  }

  function startEdit(r: BonusRule) {
    setEditing(r.id);
    setErr(null);
    setForm({
      depotId: r.depotId ?? '',
      bonusType: r.bonusType,
      name: r.name,
      metric: r.metric,
      op: r.op,
      threshold: String(r.threshold),
      rewardKind: r.rewardKind,
      rewardValue: String(r.rewardValue),
    });
    // The form sits below the list; on a phone the row and the form are never both visible.
    /*
     * `?.scrollIntoView?.(` — the SECOND `?.` matters. jsdom does not implement
     * `scrollIntoView` at all, so on a machine where this element exists the call is a
     * TypeError, not a no-op. It reddened `main` after passing on my laptop, where the
     * form happened not to be mounted when this ran and the first `?.` short-circuited.
     * Nothing about the behaviour a courier or an HR officer sees depends on it, so the
     * call being absent is fine; the throw was not.
     */
    document.getElementById('bonus-rule-form')?.scrollIntoView?.({ behavior: 'smooth' });
  }

  const depotName = (id: string | null) =>
    id
      ? (depots.data?.items.find((d) => d.id === id)?.name ?? t('hrFix.rules.depot'))
      : t('hrFix.rules.allDepots');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title={t('hrFix.rules.title')} subtitle={t('hrFix.rules.subtitle')} />

      {rules.loading ? (
        <Skeleton className="h-40" />
      ) : rules.error ? (
        <ErrorState message={t('hrFix.rules.loadFailed')} onRetry={rules.reload} />
      ) : (
        <Card className="divide-y divide-[color:var(--border)]">
          {(rules.data ?? []).length === 0 && (
            <p className="p-5 text-sm text-muted">{t('hrFix.rules.empty')}</p>
          )}
          {(rules.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <Badge tone={r.active ? 'success' : 'neutral'}>
                    {r.active ? t('hrFix.rules.active') : t('hrFix.rules.inactive')}
                  </Badge>
                  {/* CA-1-59: the saved rule's own type, in words. */}
                  <Badge tone="brand">{t(BONUS_TYPE_LABEL[r.bonusType])}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {t(BONUS_METRIC_LABEL[r.metric])} {COMPARE_OP_LABEL[r.op]}{' '}
                  {thresholdLabel(r.metric, r.threshold)} →{' '}
                  {r.rewardKind === 'FIXED' ? (
                    <Money amount={Number(r.rewardValue)} />
                  ) : (
                    t('hrFix.rules.pctOfBase', { pct: r.rewardValue })
                  )}{' '}
                  · {depotName(r.depotId)}
                </p>
              </div>
              {admin && (
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={() => startEdit(r)}>
                    {t('hrFix.rules.edit')}
                  </Button>
                  <Button variant="secondary" onClick={() => toggle(r)}>
                    {r.active ? t('hrFix.rules.deactivate') : t('hrFix.rules.activate')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {admin && (
        <form onSubmit={submit} id="bonus-rule-form">
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="col-span-full text-sm font-semibold">
              {editing ? t('hrFix.rules.editRule', { name: form.name }) : t('hrFix.rules.addRule')}
            </h2>
            <Field label={t('hrFix.rules.ruleName')}>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('hrFix.rules.ruleNameHint')}
              />
            </Field>
            <Field label={t('hrFix.rules.bonusType')}>
              <select
                value={form.bonusType}
                onChange={(e) => set('bonusType', e.target.value as BonusType)}
                className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
              >
                {/* CA-1-59: same shadowed `t` as /hr/adjustments — renamed so the
                    translator is reachable. */}
                {BONUS_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {t(BONUS_TYPE_LABEL[bt])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('hrFix.rules.metric')}>
              <select
                value={form.metric}
                onChange={(e) => set('metric', e.target.value as BonusMetric)}
                className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
              >
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(BONUS_METRIC_LABEL[m])}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('hrFix.rules.operator')}>
                <select
                  value={form.op}
                  onChange={(e) => set('op', e.target.value as CompareOp)}
                  className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
                >
                  {OPS.map((o) => (
                    <option key={o} value={o}>
                      {COMPARE_OP_LABEL[o]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('hrFix.rules.threshold')}>
                <Input
                  type="number"
                  value={form.threshold}
                  onChange={(e) => set('threshold', e.target.value)}
                />
              </Field>
            </div>
            <Field label={t('hrFix.rules.rewardKind')}>
              <select
                value={form.rewardKind}
                onChange={(e) => set('rewardKind', e.target.value as RewardKind)}
                className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(REWARD_KIND_LABEL[k])}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                form.rewardKind === 'FIXED' ? t('hrFix.rules.valueRp') : t('hrFix.rules.percent')
              }
            >
              <Input
                type="number"
                value={form.rewardValue}
                onChange={(e) => set('rewardValue', e.target.value)}
              />
            </Field>
            <Field label={t('hrFix.rules.appliesTo')}>
              <select
                value={form.depotId}
                onChange={(e) => set('depotId', e.target.value)}
                className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
              >
                <option value="">{t('hrFix.rules.allDepotsGlobal')}</option>
                {depots.data?.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {/* With the list unread the only option left is "Semua depot (global)", so a
                  rule meant for ONE depot quietly becomes a network-wide one. */}
              {depots.error && <LoadError onRetry={depots.reload} />}
            </Field>
            {err && (
              <p
                className="col-span-full text-sm font-medium text-[color:var(--danger)]"
                role="alert"
              >
                {err}
              </p>
            )}
            <div className="col-span-full flex gap-2">
              <Button type="submit" loading={saving}>
                {editing ? t('hrFix.rules.saveChanges') : t('hrFix.rules.addRule')}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY);
                    setErr(null);
                  }}
                >
                  {t('hrFix.rules.cancelEdit')}
                </Button>
              )}
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}

export default function BonusRulesPage() {
  return (
    <RequireAuth>
      <RulesBody />
    </RequireAuth>
  );
}
