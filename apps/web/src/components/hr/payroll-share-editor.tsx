'use client';

import { useMemo, useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import type { Payroll, PayrollShare } from '@/lib/hr';
import { useT } from '@/lib/locale-context';

type Col = 'days' | 'gross' | 'bonus' | 'deduction' | 'shortfall';
const COLS: Col[] = ['days', 'gross', 'bonus', 'deduction', 'shortfall'];

/**
 * Head-office correction of how a slip is divided between depots. The totals of the slip never
 * change: each money column must add back to them exactly, which is checked here as you type
 * and again on the server. Only for a DRAFT or APPROVED slip - a paid one is history.
 */
export function PayrollShareEditor({ payroll, onSaved }: { payroll: Payroll; onSaved: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const { depots } = useDepot();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PayrollShare[]>(payroll.shares ?? []);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const want = {
    gross: Number(payroll.gross),
    bonus: Number(payroll.totalBonus),
    deduction: Number(payroll.totalDeduction),
  };
  const diff = useMemo(
    () => ({
      gross: rows.reduce((a, r) => a + r.gross, 0) - want.gross,
      bonus: rows.reduce((a, r) => a + r.bonus, 0) - want.bonus,
      deduction: rows.reduce((a, r) => a + r.deduction, 0) - want.deduction,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, payroll.gross, payroll.totalBonus, payroll.totalDeduction],
  );
  const balanced = diff.gross === 0 && diff.bonus === 0 && diff.deduction === 0;
  const free = depots.filter((d) => !rows.some((r) => r.depotId === d.id));
  const name = (id: string) => depots.find((d) => d.id === id)?.name ?? id.slice(0, 8);

  function setCell(i: number, col: Col, value: string) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, [col]: n } : r)));
  }

  async function save() {
    setProblems([]);
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.reallocatePayrollShares(payroll.id),
        {
          reason: reason.trim(),
          shares: rows.map((r) => ({
            depotId: r.depotId,
            days: r.days,
            gross: r.gross,
            bonus: r.bonus,
            deduction: r.deduction,
            shortfall: r.shortfall,
          })),
        },
        true,
      );
      toast(t('hrFix.payrollDetail.reallocated'));
      setOpen(false);
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('hrFix.payrollDetail.failed');
      setProblems(message.split(', ').filter(Boolean));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('hrFix.payrollDetail.reallocate')}
      </Button>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">{t('hrFix.payrollDetail.reallocate')}</h2>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.depotId} className="space-y-2 rounded-lg border border-app p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{name(r.depotId)}</span>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="text-sm text-[color:var(--danger)]"
                  onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
                >
                  {t('hrFix.payrollDetail.removeShare')}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {COLS.map((c) => (
                <Field key={c} label={t(`hrFix.payrollDetail.col.${c}`)}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={r[c]}
                    onChange={(e) => setCell(i, c, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>
      {free.length > 0 && (
        <select
          aria-label={t('hrFix.payrollDetail.addDepot')}
          className="surface-elevated w-full rounded-lg border border-app px-3 py-2 text-sm"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            setRows((rs) => [
              ...rs,
              { depotId: e.target.value, days: 0, gross: 0, bonus: 0, deduction: 0, shortfall: 0, net: 0 },
            ]);
          }}
        >
          <option value="">{t('hrFix.payrollDetail.addDepot')}</option>
          {free.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      <p className={`text-sm ${balanced ? 'text-muted' : 'font-medium text-[color:var(--danger)]'}`} role="status">
        {balanced
          ? t('hrFix.payrollDetail.balanced')
          : t('hrFix.payrollDetail.unbalanced', { gross: diff.gross, bonus: diff.bonus, deduction: diff.deduction })}
      </p>
      <Field label={t('hrFix.payrollDetail.reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {problems.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm font-medium text-[color:var(--danger)]" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button loading={saving} disabled={!balanced || reason.trim().length < 3} onClick={save}>
          {t('hrFix.payrollDetail.saveAllocation')}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t('hrFix.payrollDetail.cancelEdit')}
        </Button>
      </div>
    </Card>
  );
}
