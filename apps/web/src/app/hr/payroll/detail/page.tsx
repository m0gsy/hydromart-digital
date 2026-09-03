'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useConfirm } from '@/components/confirm';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Money, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, getBlob } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { PAYROLL_STATUS_LABEL, type Payroll, type PayrollStatus } from '@/lib/hr';
import { canRunPayroll } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

const TONE: Record<PayrollStatus, 'neutral' | 'success' | 'brand'> = {
  DRAFT: 'neutral',
  APPROVED: 'brand',
  PAID: 'success',
};

export default function PayrollDetailPage() {
  const { t } = useT();
  const id = useQueryParam('id');
  const { customer } = useAuth();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync<Payroll>(
    () => api.get<Payroll>(endpoints.hr.payrollById(id), true),
    [id],
  );

  /*
   * CA-1-11 — both buttons below move real money and neither asked. "Setujui" freezes a
   * payroll run somebody may still be correcting; "Tandai Dibayar" says the transfers
   * left the bank. Neither has an undo on this screen, and the two sit side by side in
   * the same place, so a mis-tap on a phone is one pixel of travel from the right button.
   */
  async function act(path: string, ok: string, question: string, confirmLabel: string) {
    if (!(await confirm({ title: confirmLabel, message: question, tone: 'primary', confirmLabel })))
      return;
    setBusy(true);
    try {
      await api.post(path, undefined, true);
      toast(ok);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.payrollDetail.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function downloadSlip() {
    try {
      downloadBlob(`slip-${id}.pdf`, await getBlob(endpoints.hr.payrollSlip(id)));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('hrFix.payrollDetail.downloadFailed'), 'error');
    }
  }

  if (loading) return <Skeleton className="mx-auto h-96 max-w-2xl" />;
  if (error)
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  const p = data!;
  const canRun = canRunPayroll(customer?.role);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* PG-01: the slip named nobody, and the Approve / Mark paid buttons below act on
          real money. The name is the title now; the period is the subtitle it always was. */}
      <SectionHeader
        title={p.employeeName ?? t('hrFix.payroll.unnamedEmployee')}
        subtitle={`${t('hrFix.myPayrollDetail.slipTitle', { period: p.periodMonth })} · ${t('hrFix.payrollDetail.presentDays', { days: p.presentDays })}`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadSlip}>
              {t('hrFix.payrollDetail.downloadPdf')}
            </Button>
            <Badge tone={TONE[p.status]}>{t(PAYROLL_STATUS_LABEL[p.status])}</Badge>
          </div>
        }
      />

      <Card className="p-5">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-[color:var(--border)]">
            {(p.items ?? []).map((it) => (
              <tr key={it.id}>
                <td className="py-2">{it.label}</td>
                <td
                  className={`py-2 text-right tabular-nums ${it.kind === 'DEDUCTION' ? 'text-red-600' : ''}`}
                >
                  {it.kind === 'DEDUCTION' ? '−' : ''}
                  <Money amount={Math.abs(Number(it.amount))} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-app font-bold">
              <td className="pt-3">{t('hrFix.payrollDetail.netPay')}</td>
              <td className="pt-3 text-right">
                <Money amount={Number(p.net)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Card className="p-3">
          <p className="text-muted">Gross</p>
          <Money amount={Number(p.gross)} className="font-bold" />
        </Card>
        <Card className="p-3">
          <p className="text-muted">Bonus</p>
          <Money amount={Number(p.totalBonus)} className="font-bold" />
        </Card>
        <Card className="p-3">
          <p className="text-muted">{t('hrFix.payrollDetail.deduction')}</p>
          <Money amount={Number(p.totalDeduction)} className="font-bold" />
        </Card>
      </div>

      {canRun && (
        <div className="flex gap-3">
          {p.status === 'DRAFT' && (
            <Button
              onClick={() =>
                act(
                  endpoints.hr.approvePayroll(id),
                  t('hrFix.payrollDetail.approved'),
                  t('hrFix.payrollDetail.approveConfirm', { net: formatIDR(Number(p.net)) }),
                  t('hrFix.payrollDetail.approve'),
                )
              }
              loading={busy}
            >
              {t('hrFix.payrollDetail.approve')}
            </Button>
          )}
          {p.status === 'APPROVED' && (
            <Button
              onClick={() =>
                act(
                  endpoints.hr.payPayroll(id),
                  t('hrFix.payrollDetail.markedPaid'),
                  t('hrFix.payrollDetail.markPaidConfirm', { net: formatIDR(Number(p.net)) }),
                  t('hrFix.payrollDetail.markPaid'),
                )
              }
              loading={busy}
            >
              {t('hrFix.payrollDetail.markPaid')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
