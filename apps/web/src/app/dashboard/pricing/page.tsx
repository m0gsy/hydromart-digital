'use client';

import { useState } from 'react';
import { Lock, Tag } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canManagePricing } from '@/lib/roles';
import { EMPTY_RULE_FORM, toRulePayload, type RuleForm } from '@/lib/pricing';
import { useAsync } from '@/lib/use-async';
import type { PricingRule } from '@/lib/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function windowSummary(r: PricingRule): string {
  const days = r.daysOfWeek.length === 0 ? 'Every day' : r.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ');
  const time =
    r.startMinute == null && r.endMinute == null
      ? 'all day'
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
      setError(err instanceof ApiError ? err.message : 'Could not save the pricing rule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{rule ? 'Edit pricing rule' : 'New pricing rule'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product id" htmlFor="r-product" hint="Blank = applies to every product in this depot">
          <Input id="r-product" value={form.productId} onChange={set('productId')} placeholder="Blank = all products" />
        </Field>
        <Field label="Adjustment type" htmlFor="r-type">
          <select
            id="r-type"
            value={form.adjustType}
            onChange={set('adjustType')}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
          >
            <option value="PERCENT">Percent</option>
            <option value="FIXED">Fixed (IDR)</option>
          </select>
        </Field>
        <Field
          label="Value"
          htmlFor="r-value"
          hint={form.adjustType === 'PERCENT' ? 'e.g. -10 for 10% off' : 'e.g. -2000 for Rp2,000 off'}
        >
          <Input id="r-value" inputMode="decimal" value={form.value} onChange={set('value')} placeholder="-10" />
        </Field>
        <Field label="Priority" htmlFor="r-priority" hint="Higher wins on overlap; blank = 0">
          <Input id="r-priority" inputMode="numeric" value={form.priority} onChange={set('priority')} placeholder="0" />
        </Field>
        <Field label="Start time" htmlFor="r-start" hint="Blank = no lower bound">
          <Input id="r-start" type="time" value={form.startTime} onChange={set('startTime')} />
        </Field>
        <Field label="End time" htmlFor="r-end" hint="Blank = no upper bound">
          <Input id="r-end" type="time" value={form.endTime} onChange={set('endTime')} />
        </Field>
        <Field label="Valid from" htmlFor="r-from" hint="Blank = open-ended">
          <Input id="r-from" type="date" value={form.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label="Valid until" htmlFor="r-until" hint="Blank = open-ended">
          <Input id="r-until" type="date" value={form.validUntil} onChange={set('validUntil')} />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">Days of week</p>
        <div className="flex flex-wrap gap-3">
          {DAY_LABELS.map((label, day) => (
            <label key={day} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">None selected = every day.</p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
        />
        Active
      </label>

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} loading={busy}>
          {rule ? 'Save changes' : 'Create rule'}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm('Delete this pricing rule?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.pricing.detail(depotId, rule.id), true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the pricing rule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{rule.productId ?? 'All products'}</p>
          <p className="text-xs text-muted">{windowSummary(rule)}</p>
        </div>
        <Badge tone={rule.active ? 'success' : 'neutral'}>{rule.active ? 'Active' : 'Inactive'}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">Adjustment</dt>
          <dd className="font-semibold tabular-nums">{adjustmentLabel(rule)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Priority</dt>
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
          Edit
        </Button>
        <Button variant="danger" onClick={remove} loading={busy}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

function PricingBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const depotId = scopedId ?? '';
  const [editing, setEditing] = useState<PricingRule | null | 'new'>(null);

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
          <h1 className="text-2xl font-bold">Dynamic pricing</h1>
        </div>
        {depotId && editing === null && <Button onClick={() => setEditing('new')}>New rule</Button>}
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          Aturan untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>
          . Prioritas lebih tinggi menang saat tumpang tindih.
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="No depots" icon={<Tag size={40} weight="fill" />}>
          No depots are configured yet.
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
            <CenterState title="No pricing rules yet" icon={<Tag size={40} weight="fill" />}>
              Create a rule to discount this depot or one of its products.
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
  const { customer } = useAuth();
  if (!canManagePricing(customer?.role)) {
    return (
      <CenterState title="Pricing managers only" icon={<Lock size={40} weight="fill" />}>
        Dynamic pricing is available to depot managers and head office.
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
