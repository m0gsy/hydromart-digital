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
  BONUS_TYPES,
  COMPARE_OP_LABEL,
  REWARD_KIND_LABEL,
  type BonusMetric,
  type BonusRule,
  type BonusType,
  type CompareOp,
  type RewardKind,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

interface DepotOption {
  id: string;
  name: string;
}

const METRICS = Object.keys(BONUS_METRIC_LABEL) as BonusMetric[];
const OPS = Object.keys(COMPARE_OP_LABEL) as CompareOp[];
const KINDS = Object.keys(REWARD_KIND_LABEL) as RewardKind[];

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
    try {
      await api.post(
        endpoints.hr.createBonusRule,
        {
          ...(form.depotId ? { depotId: form.depotId } : {}),
          bonusType: form.bonusType,
          name: form.name.trim(),
          metric: form.metric,
          op: form.op,
          threshold,
          rewardKind: form.rewardKind,
          rewardValue,
        },
        true,
      );
      notify(t('hrFix.rules.added'));
      setForm(EMPTY);
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
        <ErrorState message="Gagal memuat rule" onRetry={rules.reload} />
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
                  <Badge tone="brand">{r.bonusType}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {t(BONUS_METRIC_LABEL[r.metric])} {COMPARE_OP_LABEL[r.op]} {r.threshold} →{' '}
                  {r.rewardKind === 'FIXED' ? (
                    <Money amount={Number(r.rewardValue)} />
                  ) : (
                    t('hrFix.rules.pctOfBase', { pct: r.rewardValue })
                  )}{' '}
                  · {depotName(r.depotId)}
                </p>
              </div>
              {admin && (
                <Button variant="secondary" onClick={() => toggle(r)}>
                  {r.active ? t('hrFix.rules.deactivate') : t('hrFix.rules.activate')}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      {admin && (
        <form onSubmit={submit}>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="col-span-full text-sm font-semibold">{t('hrFix.rules.addRule')}</h2>
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
                {BONUS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
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
              <p className="col-span-full text-sm font-medium text-red-600" role="alert">
                {err}
              </p>
            )}
            <div className="col-span-full">
              <Button type="submit" loading={saving}>
                {t('hrFix.rules.addRule')}
              </Button>
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
