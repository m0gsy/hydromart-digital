'use client';

import { useState } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Field, Input, Money, SectionHeader, Skeleton } from '@/components/ui';
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

interface DepotOption { id: string; name: string }

const METRICS = Object.keys(BONUS_METRIC_LABEL) as BonusMetric[];
const OPS = Object.keys(COMPARE_OP_LABEL) as CompareOp[];
const KINDS = Object.keys(REWARD_KIND_LABEL) as RewardKind[];

const EMPTY = {
  depotId: '', bonusType: 'ATTENDANCE' as BonusType, name: '', metric: 'ATTENDANCE_RATE' as BonusMetric,
  op: 'GTE' as CompareOp, threshold: '', rewardKind: 'FIXED' as RewardKind, rewardValue: '',
};

function RulesBody() {
  const { customer } = useAuth();
  const admin = canManageHr(customer?.role);
  const { toast: notify } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rules = useAsync<BonusRule[]>(() => api.get<BonusRule[]>(endpoints.hr.bonusRules(), true), []);
  const depots = useAsync<{ items: DepotOption[] }>(() => api.get<{ items: DepotOption[] }>(endpoints.depots.browse({ limit: 100 }), true), []);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim()) return setErr('Nama rule wajib diisi.');
    const threshold = Number(form.threshold);
    const rewardValue = Number(form.rewardValue);
    if (!(threshold >= 0)) return setErr('Ambang (threshold) tidak valid.');
    if (!(rewardValue >= 0)) return setErr('Nilai reward tidak valid.');
    setSaving(true);
    try {
      await api.post(endpoints.hr.createBonusRule, {
        ...(form.depotId ? { depotId: form.depotId } : {}),
        bonusType: form.bonusType, name: form.name.trim(), metric: form.metric, op: form.op,
        threshold, rewardKind: form.rewardKind, rewardValue,
      }, true);
      notify('Rule bonus ditambahkan');
      setForm(EMPTY);
      rules.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Gagal menyimpan.');
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
      notify('Gagal mengubah status rule', 'error');
    }
  }

  const depotName = (id: string | null) => (id ? depots.data?.items.find((d) => d.id === id)?.name ?? 'Depot' : 'Semua depot');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title="Rule Bonus Otomatis" subtitle="Bonus dihitung otomatis saat payroll dibuat" />

      {rules.loading ? <Skeleton className="h-40" /> : rules.error ? <ErrorState message="Gagal memuat rule" onRetry={rules.reload} /> : (
        <Card className="divide-y divide-[color:var(--border)]">
          {(rules.data ?? []).length === 0 && <p className="p-5 text-sm text-muted">Belum ada rule.</p>}
          {(rules.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Aktif' : 'Nonaktif'}</Badge>
                  <Badge tone="brand">{r.bonusType}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {BONUS_METRIC_LABEL[r.metric]} {COMPARE_OP_LABEL[r.op]} {r.threshold} →{' '}
                  {r.rewardKind === 'FIXED' ? <Money amount={Number(r.rewardValue)} /> : `${r.rewardValue}% gaji pokok`} · {depotName(r.depotId)}
                </p>
              </div>
              {admin && <Button variant="secondary" onClick={() => toggle(r)}>{r.active ? 'Nonaktifkan' : 'Aktifkan'}</Button>}
            </div>
          ))}
        </Card>
      )}

      {admin && (
        <form onSubmit={submit}>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="col-span-full text-sm font-semibold">Tambah Rule</h2>
            <Field label="Nama rule"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Bonus Kehadiran Penuh" /></Field>
            <Field label="Jenis bonus">
              <select value={form.bonusType} onChange={(e) => set('bonusType', e.target.value as BonusType)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
                {BONUS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Metrik">
              <select value={form.metric} onChange={(e) => set('metric', e.target.value as BonusMetric)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
                {METRICS.map((m) => <option key={m} value={m}>{BONUS_METRIC_LABEL[m]}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Operator">
                <select value={form.op} onChange={(e) => set('op', e.target.value as CompareOp)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
                  {OPS.map((o) => <option key={o} value={o}>{COMPARE_OP_LABEL[o]}</option>)}
                </select>
              </Field>
              <Field label="Ambang"><Input type="number" value={form.threshold} onChange={(e) => set('threshold', e.target.value)} /></Field>
            </div>
            <Field label="Jenis reward">
              <select value={form.rewardKind} onChange={(e) => set('rewardKind', e.target.value as RewardKind)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
                {KINDS.map((k) => <option key={k} value={k}>{REWARD_KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label={form.rewardKind === 'FIXED' ? 'Nilai (Rp)' : 'Persen (%)'}><Input type="number" value={form.rewardValue} onChange={(e) => set('rewardValue', e.target.value)} /></Field>
            <Field label="Berlaku untuk">
              <select value={form.depotId} onChange={(e) => set('depotId', e.target.value)} className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm">
                <option value="">Semua depot (global)</option>
                {depots.data?.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            {err && <p className="col-span-full text-sm font-medium text-red-600" role="alert">{err}</p>}
            <div className="col-span-full"><Button type="submit" loading={saving}>Tambah Rule</Button></div>
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
