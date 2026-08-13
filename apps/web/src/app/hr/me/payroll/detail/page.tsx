'use client';

import { useToast } from '@/components/toast';
import { useT } from '@/lib/locale-context';
import { Badge, Card, ErrorState, Money, SectionHeader, Skeleton } from '@/components/ui';
import { api, getBlob } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { PAYROLL_STATUS_LABEL, type Payroll, type PayrollStatus } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

const TONE: Record<PayrollStatus, 'neutral' | 'success' | 'brand'> = {
  DRAFT: 'neutral',
  APPROVED: 'brand',
  PAID: 'success',
};

/**
 * An employee's own payslip.
 *
 * "Slip Gaji Saya" used to link to `/hr/payroll/detail`, which is broken twice over for
 * the person it was for: the Ops binary prunes the whole HR console except `hr/me`, so on
 * a phone the tap landed on a route that does not exist — and even on the web the detail
 * API is `hrView`-gated, which no ordinary employee has, so it would have 403'd anyway.
 *
 * Same layout as the staff detail screen, minus the approve/pay actions: an employee has
 * no business approving their own payroll. Reads the self endpoints, which are scoped by
 * ownership rather than by depot.
 */
export default function MyPayrollDetailPage() {
  const { t } = useT();
  const id = useQueryParam('id');
  const { toast } = useToast();

  const { data, error, loading, reload } = useAsync<Payroll>(
    () => api.get<Payroll>(endpoints.hr.payrollMeById(id), true),
    [id],
  );

  async function downloadSlip() {
    try {
      downloadBlob(`slip-${id}.pdf`, await getBlob(endpoints.hr.payrollMeSlip(id)));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal unduh', 'error');
    }
  }

  if (loading) return <Skeleton className="mx-auto h-96 max-w-md" />;
  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  const p = data!;

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader
        title={`Slip Gaji ${p.periodMonth}`}
        subtitle={`${p.presentDays} hari hadir`}
        action={<Badge tone={TONE[p.status]}>{t(PAYROLL_STATUS_LABEL[p.status])}</Badge>}
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
              <td className="pt-3">Gaji Bersih (Net)</td>
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
          <p className="text-muted">Potongan</p>
          <Money amount={Number(p.totalDeduction)} className="font-bold" />
        </Card>
      </div>

      <button
        type="button"
        onClick={downloadSlip}
        className="w-full rounded-lg border border-app px-4 py-2.5 text-sm font-semibold hover:bg-brand-50"
      >
        Unduh PDF
      </button>
    </div>
  );
}
