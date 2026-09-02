'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, LoadError, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  ALLOWANCE_TYPES,
  ALLOWANCE_TYPE_LABEL,
  fmtDate,
  type Allowance,
  type AllowanceType,
} from '@/lib/hr';
import { useAuth } from '@/lib/auth-context';
import { canRunPayroll } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { todayWib } from '@/lib/wib';

/**
 * Recurring pay components. Unlike a bonus (one period, one row) an allowance repeats every
 * payroll run until it lapses, so it is stopped rather than deleted — a past payslip has to
 * stay explainable.
 *
 * CA-1-27: the write gate is asked FOR here rather than passed in. Both screens that render
 * this panel handed it one `isAdmin` computed from `hrAdmin` — the capability for employee
 * master data — while `allowance.controller.ts` guards POST, POST /import and PATCH
 * /:id/deactivate with `hrPayroll`, because an allowance is salary. The two lists are not
 * the same list in either direction: HEAD_OFFICE and DIREKTUR hold `hrAdmin` and were shown
 * an "Tambah tunjangan" form the server refuses, and FINANCE holds `hrPayroll` and was shown
 * no form at all on a screen it is meant to run. A panel that knows which capability its own
 * writes need cannot be handed the wrong answer by a third caller.
 */
export function EmployeeAllowances({ employeeId }: { employeeId: string }) {
  const { t } = useT();
  const { customer } = useAuth();
  const isAdmin = canRunPayroll(customer?.role);
  const { toast: notify } = useToast();
  const [type, setType] = useState<AllowanceType>('TRANSPORT');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(todayWib());
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allowances = useAsync<Allowance[]>(
    () => api.get<Allowance[]>(endpoints.hr.allowances(employeeId), true),
    [employeeId],
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const value = Number(amount);
    if (!(value > 0)) return setErr(t('hrFix.allowances.amountPositive'));
    if (!from) return setErr(t('hrFix.allowances.startRequired'));
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.createAllowance,
        {
          employeeId,
          type,
          amount: value,
          effectiveFrom: new Date(from).toISOString(),
          ...(to ? { effectiveTo: new Date(to).toISOString() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        true,
      );
      notify(t('hrFix.allowances.added'));
      setAmount('');
      setNote('');
      setTo('');
      allowances.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('hrFix.allowances.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function stop(id: string) {
    try {
      await api.patch(endpoints.hr.deactivateAllowance(id), {}, true);
      allowances.reload();
    } catch {
      notify(t('hrFix.allowances.stopFailed'), 'error');
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">{t('hrFix.allowances.title')}</h2>
      <p className="text-xs text-muted">
        {t('hrFix.allowances.fixedHint')}
      </p>
      {allowances.loading ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="divide-y divide-[color:var(--border)]">
          {/* Allowances are pay. "Belum ada" here is a payroll statement, not a blank list. */}
          {allowances.error ? (
            <LoadError onRetry={allowances.reload} />
          ) : (
            (allowances.data ?? []).length === 0 && (
              <p className="text-sm text-muted">{t('hrFix.allowances.empty')}</p>
            )
          )}
          {(allowances.data ?? []).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    <Money amount={Number(a.amount)} />
                  </span>
                  <Badge tone={a.active ? 'success' : 'neutral'}>
                    {a.active ? t('hrFix.allowances.running') : t('hrFix.allowances.stopped')}
                  </Badge>
                </div>
                <p className="text-sm text-muted">
                  {t(ALLOWANCE_TYPE_LABEL[a.type])} · sejak {fmtDate(a.effectiveFrom)}
                  {a.effectiveTo ? ` s/d ${fmtDate(a.effectiveTo)}` : ''}
                  {a.note ? ` · ${a.note}` : ''}
                </p>
              </div>
              {isAdmin && a.active && (
                <Button variant="secondary" onClick={() => stop(a.id)}>
                  Hentikan
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={add}
          className="grid gap-3 border-t border-[color:var(--border)] pt-4 sm:grid-cols-2"
        >
          <Field label={t('hrFix.allowances.type')}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AllowanceType)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {ALLOWANCE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(ALLOWANCE_TYPE_LABEL[ty])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('hrFix.allowances.amountPerMonth')}>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('hrFix.allowances.start')}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('hrFix.allowances.end')}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label={t('hrFix.allowances.noteOpt')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {err && (
            <p className="col-span-full text-sm font-medium text-red-600" role="alert">
              {err}
            </p>
          )}
          <div className="col-span-full">
            <Button type="submit" loading={saving}>
              {t('hrFix.allowances.addAllowance2')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
