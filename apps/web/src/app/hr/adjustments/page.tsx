'use client';

import { useState } from 'react';

import { EmployeeSelect } from '@/components/hr/employee-select';
import { useToast } from '@/components/toast';
import { useT } from '@/lib/locale-context';
import { Button, Card, Input, LinkButton, Money, SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  BONUS_TYPES,
  DEDUCTION_TYPES,
  currentPeriod,
  fmtDate,
  type Bonus,
  type Deduction,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';

type Kind = 'bonus' | 'deduction';

export default function AdjustmentsPage() {
  const { customer } = useAuth();
  const { toast } = useToast();
  const { t } = useT();
  const isAdmin = canManageHr(customer?.role);

  const [employeeId, setEmployeeId] = useState('');
  const [period, setPeriod] = useState(currentPeriod());
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [kind, setKind] = useState<Kind>('bonus');
  const [type, setType] = useState<string>('MANUAL');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!employeeId) {
      toast(t('hrFix.adjustments.fillEmployeeId'), 'error');
      return;
    }
    try {
      const [b, d] = await Promise.all([
        api.get<Bonus[]>(endpoints.hr.bonuses(employeeId, period), true),
        api.get<Deduction[]>(endpoints.hr.deductions(employeeId, period), true),
      ]);
      setBonuses(b);
      setDeductions(d);
      setLoaded(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.adjustments.loadFailed'), 'error');
    }
  }

  async function add() {
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast(t('hrFix.adjustments.amountPositive'), 'error');
      return;
    }
    setBusy(true);
    try {
      const path = kind === 'bonus' ? endpoints.hr.createBonus : endpoints.hr.createDeduction;
      await api.post(path, { employeeId, type, amount: amt, periodMonth: period, note: note || undefined }, true);
      toast(kind === 'bonus' ? t('hrFix.adjustments.bonusAdded') : t('hrFix.adjustments.deductionAdded'));
      setAmount('');
      setNote('');
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.adjustments.saveFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const types = kind === 'bonus' ? BONUS_TYPES : DEDUCTION_TYPES;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('hrFix.adjustments.title')}
        subtitle={t('hrFix.adjustments.subtitle')}
        action={
          isAdmin ? (
            <LinkButton href="/hr/adjustments/import" variant="secondary">
              Import Potongan
            </LinkButton>
          ) : undefined
        }
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        {/* G-1: was `placeholder={t('hrFix.adjustments.employeeIdHint')}` — a human being asked to paste a UUID. */}
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} className="w-64" />
        <label className="text-sm">{t('hrFix.adjustments.period')}<Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <Button variant="secondary" onClick={load}>{t('hrFix.adjustments.load')}</Button>
      </Card>

      {loaded && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 font-bold text-green-700">{t('hrFix.adjustments.bonus')}</h3>
              {bonuses.length === 0 ? <p className="text-sm text-muted">—</p> : bonuses.map((b) => (
                <div key={b.id} className="flex justify-between py-1 text-sm"><span>{b.type}{b.note ? ` · ${b.note}` : ''} <span className="text-muted">· {fmtDate(b.createdAt)}</span></span><Money amount={Number(b.amount)} /></div>
              ))}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 font-bold text-red-700">{t('hrFix.adjustments.deduction')}</h3>
              {deductions.length === 0 ? <p className="text-sm text-muted">—</p> : deductions.map((d) => (
                <div key={d.id} className="flex justify-between py-1 text-sm"><span>{d.type}{d.note ? ` · ${d.note}` : ''} <span className="text-muted">· {fmtDate(d.createdAt)}</span></span><Money amount={Number(d.amount)} /></div>
              ))}
            </Card>
          </div>

          {isAdmin && (
            <Card className="space-y-3 p-4">
              <h3 className="font-bold">{t('hrFix.adjustments.add')}</h3>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">Jenis
                  <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setType(e.target.value === 'bonus' ? 'MANUAL' : 'MANUAL'); }} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
                    <option value="bonus">{t('hrFix.adjustments.bonus')}</option>
                    <option value="deduction">{t('hrFix.adjustments.deduction')}</option>
                  </select>
                </label>
                <label className="text-sm">Tipe
                  <select value={type} onChange={(e) => setType(e.target.value)} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
                    {types.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="text-sm">{t('hrFix.adjustments.amount')}<Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" /></label>
                <label className="text-sm">{t('hrFix.adjustments.note')}<Input value={note} onChange={(e) => setNote(e.target.value)} className="w-40" /></label>
                <Button onClick={add} loading={busy}>{t('hrFix.adjustments.save')}</Button>
              </div>
            </Card>
          )}
          {/* This line used to stamp TODAY on rows that were entered weeks ago — every
              adjustment carries its own createdAt, and it is now shown on the row. */}
          <p className="text-xs text-muted">{t('hrFix.adjustments.entersPayroll')}</p>
        </>
      )}
    </div>
  );
}
