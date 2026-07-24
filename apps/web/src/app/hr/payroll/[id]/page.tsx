'use client';

import { use, useState } from 'react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Money, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { PAYROLL_STATUS_LABEL, type Payroll, type PayrollStatus } from '@/lib/hr';
import { canRunPayroll } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const TONE: Record<PayrollStatus, 'neutral' | 'success' | 'brand'> = { DRAFT: 'neutral', APPROVED: 'brand', PAID: 'success' };

export default function PayrollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { customer } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync<Payroll>(() => api.get<Payroll>(endpoints.hr.payrollById(id), true), [id]);

  async function act(path: string, ok: string) {
    setBusy(true);
    try {
      await api.post(path, undefined, true);
      toast(ok);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function downloadSlip() {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    try {
      const r = await fetch(`${base}${endpoints.hr.payrollSlip(id)}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`Gagal (${r.status})`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `slip-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal unduh', 'error');
    }
  }

  if (loading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (error) return <div className="mx-auto max-w-2xl"><ErrorState message={error} onRetry={reload} /></div>;
  const p = data!;
  const canRun = canRunPayroll(customer?.role);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <SectionHeader
        title={`Slip Gaji ${p.periodMonth}`}
        subtitle={`${p.presentDays} hari hadir`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadSlip}>Unduh PDF</Button>
            <Badge tone={TONE[p.status]}>{PAYROLL_STATUS_LABEL[p.status]}</Badge>
          </div>
        }
      />

      <Card className="p-5">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-[color:var(--border)]">
            {(p.items ?? []).map((it) => (
              <tr key={it.id}>
                <td className="py-2">{it.label}</td>
                <td className={`py-2 text-right tabular-nums ${it.kind === 'DEDUCTION' ? 'text-red-600' : ''}`}>
                  {it.kind === 'DEDUCTION' ? '−' : ''}<Money amount={Math.abs(Number(it.amount))} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-app font-bold">
              <td className="pt-3">Gaji Bersih (Net)</td>
              <td className="pt-3 text-right"><Money amount={Number(p.net)} /></td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Card className="p-3"><p className="text-muted">Gross</p><Money amount={Number(p.gross)} className="font-bold" /></Card>
        <Card className="p-3"><p className="text-muted">Bonus</p><Money amount={Number(p.totalBonus)} className="font-bold" /></Card>
        <Card className="p-3"><p className="text-muted">Potongan</p><Money amount={Number(p.totalDeduction)} className="font-bold" /></Card>
      </div>

      {canRun && (
        <div className="flex gap-3">
          {p.status === 'DRAFT' && <Button onClick={() => act(endpoints.hr.approvePayroll(id), 'Payroll disetujui')} loading={busy}>Setujui</Button>}
          {p.status === 'APPROVED' && <Button onClick={() => act(endpoints.hr.payPayroll(id), 'Ditandai dibayar')} loading={busy}>Tandai Dibayar</Button>}
        </div>
      )}
    </div>
  );
}
