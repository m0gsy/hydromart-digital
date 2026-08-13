'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, LoadError, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { currentPeriod, type LoanView } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

/** Employee loans / kasbon — auto-deducted from payroll. Shows computed remaining balance. */
export function EmployeeLoans({ employeeId, isAdmin }: { employeeId: string; isAdmin: boolean }) {
  const { toast: notify } = useToast();
  const [principal, setPrincipal] = useState('');
  const [installment, setInstallment] = useState('');
  const [startPeriod, setStartPeriod] = useState(currentPeriod());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loans = useAsync<LoanView[]>(() => api.get<LoanView[]>(endpoints.hr.loans(employeeId), true), [employeeId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = Number(principal);
    const inst = Number(installment);
    if (!(p > 0)) return setErr('Pokok pinjaman harus > 0.');
    if (!(inst > 0)) return setErr('Cicilan per bulan harus > 0.');
    setSaving(true);
    try {
      await api.post(endpoints.hr.createLoan, { employeeId, principal: p, installmentAmount: inst, startPeriod, note: note.trim() || undefined }, true);
      notify('Pinjaman ditambahkan');
      setPrincipal(''); setInstallment(''); setNote('');
      loans.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  async function stop(id: string) {
    try {
      await api.patch(endpoints.hr.deactivateLoan(id), {}, true);
      loans.reload();
    } catch {
      // `toast()` defaults to tone 'success' — a failure that says nothing about its tone
      // renders GREEN with a tick, which is the one thing a failed write must not look like.
      notify('Gagal menghentikan pinjaman', 'error');
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Pinjaman / Kasbon</h2>
      {loans.loading ? <Skeleton className="h-16" /> : (
        <div className="divide-y divide-[color:var(--border)]">
          {/* "Belum ada pinjaman" is what payroll reads before deciding there is nothing
              to deduct this month. */}
          {loans.error ? (
            <LoadError onRetry={loans.reload} />
          ) : (
            (loans.data ?? []).length === 0 && <p className="text-sm text-muted">Belum ada pinjaman.</p>
          )}
          {(loans.data ?? []).map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold"><Money amount={Number(l.principal)} /></span>
                  <Badge tone={l.settled ? 'neutral' : l.active ? 'success' : 'neutral'}>{l.settled ? 'Lunas' : l.active ? 'Berjalan' : 'Dihentikan'}</Badge>
                </div>
                <p className="text-sm text-muted">
                  Cicilan <Money amount={Number(l.installmentAmount)} />/bln sejak {l.startPeriod} · sisa <Money amount={l.remaining} />
                  {l.note ? ` · ${l.note}` : ''}
                </p>
              </div>
              {isAdmin && l.active && !l.settled && <Button variant="secondary" onClick={() => stop(l.id)}>Hentikan</Button>}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <form onSubmit={add} className="grid gap-3 border-t border-[color:var(--border)] pt-4 sm:grid-cols-2">
          <Field label="Pokok pinjaman (Rp)"><Input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></Field>
          <Field label="Cicilan / bulan (Rp)"><Input type="number" value={installment} onChange={(e) => setInstallment(e.target.value)} /></Field>
          <Field label="Mulai periode"><Input type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} /></Field>
          <Field label="Catatan (opsional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {err && <p className="col-span-full text-sm font-medium text-red-600" role="alert">{err}</p>}
          <div className="col-span-full"><Button type="submit" loading={saving}>Tambah Pinjaman</Button></div>
        </form>
      )}
    </Card>
  );
}
