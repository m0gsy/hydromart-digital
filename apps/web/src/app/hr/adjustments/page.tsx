'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, Input, Money, SectionHeader } from '@/components/ui';
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
      toast('Isi employeeId', 'error');
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
      toast(e instanceof ApiError ? e.message : 'Gagal memuat', 'error');
    }
  }

  async function add() {
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast('Nominal harus > 0', 'error');
      return;
    }
    setBusy(true);
    try {
      const path = kind === 'bonus' ? endpoints.hr.createBonus : endpoints.hr.createDeduction;
      await api.post(path, { employeeId, type, amount: amt, periodMonth: period, note: note || undefined }, true);
      toast(kind === 'bonus' ? 'Bonus ditambahkan' : 'Potongan ditambahkan');
      setAmount('');
      setNote('');
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  const types = kind === 'bonus' ? BONUS_TYPES : DEDUCTION_TYPES;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Bonus & Potongan" subtitle="Per karyawan per periode" />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">Employee ID<Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="UUID karyawan" className="w-64" /></label>
        <label className="text-sm">Periode<Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <Button variant="secondary" onClick={load}>Muat</Button>
      </Card>

      {loaded && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 font-bold text-green-700">Bonus</h3>
              {bonuses.length === 0 ? <p className="text-sm text-muted">—</p> : bonuses.map((b) => (
                <div key={b.id} className="flex justify-between py-1 text-sm"><span>{b.type}{b.note ? ` · ${b.note}` : ''}</span><Money amount={Number(b.amount)} /></div>
              ))}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 font-bold text-red-700">Potongan</h3>
              {deductions.length === 0 ? <p className="text-sm text-muted">—</p> : deductions.map((d) => (
                <div key={d.id} className="flex justify-between py-1 text-sm"><span>{d.type}{d.note ? ` · ${d.note}` : ''}</span><Money amount={Number(d.amount)} /></div>
              ))}
            </Card>
          </div>

          {isAdmin && (
            <Card className="space-y-3 p-4">
              <h3 className="font-bold">Tambah</h3>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">Jenis
                  <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setType(e.target.value === 'bonus' ? 'MANUAL' : 'MANUAL'); }} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
                    <option value="bonus">Bonus</option>
                    <option value="deduction">Potongan</option>
                  </select>
                </label>
                <label className="text-sm">Tipe
                  <select value={type} onChange={(e) => setType(e.target.value)} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
                    {types.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="text-sm">Nominal<Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" /></label>
                <label className="text-sm">Catatan<Input value={note} onChange={(e) => setNote(e.target.value)} className="w-40" /></label>
                <Button onClick={add} loading={busy}>Simpan</Button>
              </div>
            </Card>
          )}
          <p className="text-xs text-muted">Dibuat {fmtDate(new Date().toISOString())} · masuk ke payroll saat digenerate.</p>
        </>
      )}
    </div>
  );
}
