'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useConfirm } from '@/components/confirm';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  fmtDate,
  leaveDeductsQuota,
  type HrPage,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const TONE: Record<LeaveStatus, 'success' | 'neutral' | 'danger' | 'brand'> = {
  PENDING_MANAGER: 'brand',
  PENDING_HR: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/** Employee self-service: apply for leave and follow it through both approval stages. */
export default function MyLeavePage() {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [type, setType] = useState<LeaveType>('ANNUAL');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requests = useAsync<HrPage<LeaveRequest>>(
    () => api.get<HrPage<LeaveRequest>>(endpoints.hr.leaveMe({ pageSize: 50 }), true),
    [],
  );
  const balance = useAsync<LeaveBalance>(
    () => api.get<LeaveBalance>(endpoints.hr.leaveBalanceMe(), true),
    [],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!startDate || !endDate) return setErr(t('hrFix.myLeave.datesRequired'));
    if (!reason.trim()) return setErr(t('hrFix.myLeave.reasonRequired'));
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.submitLeave,
        {
          type,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          reason: reason.trim(),
        },
        true,
      );
      toast(t('hrFix.myLeave.submitted'));
      setReason('');
      requests.reload();
      balance.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('hrFix.myLeave.submitFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    // CA-1-15: cancelling withdraws the request from the approver's queue; re-filing it
    // means starting the approval chain over, and the dates may no longer be free.
    const ok = await confirm({
      title: t('hrFix.myLeave.cancel'),
      message: t('hrFix.myLeave.cancelConfirm'),
      confirmLabel: t('hrFix.myLeave.cancel'),
    });
    if (!ok) return;
    try {
      await api.patch(endpoints.hr.cancelLeave(id), {}, true);
      toast(t('hrFix.myLeave.cancelled'));
      requests.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.myLeave.cancelFailed'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader
        title={t('hrFix.myLeave.title')}
        subtitle={
          balance.data
            ? t('hrFix.myLeave.quotaLine', { quota: balance.data.quotaDays, used: balance.data.usedDays, left: balance.data.quotaDays - balance.data.usedDays })
            : balance.error
              ? t('hrFix.myLeave.quotaUnreadable')
              : t('hrFix.myLeave.subtitle')
        }
      />

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('hrFix.myLeave.type')}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {LEAVE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(LEAVE_TYPE_LABEL[ty])}
                  {leaveDeductsQuota(ty) ? t('hrFix.myLeave.deductsQuota') : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('hrFix.myLeave.start')}>
            <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('hrFix.myLeave.end')}>
            <Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label={t('hrFix.myLeave.reason')}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('hrFix.myLeave.reasonHint')}
            />
          </Field>
          {err && (
            <p className="text-sm font-medium text-red-600" role="alert">
              {err}
            </p>
          )}
          <Button type="submit" loading={saving} className="w-full">
            {t('hrFix.myLeave.apply2')}
          </Button>
          <p className="text-xs text-muted">
            {t('hrFix.myLeave.holidayHint')}
          </p>
        </form>
      </Card>

      {requests.loading && <Skeleton className="h-24" />}
      {requests.error && <ErrorState message={requests.error} onRetry={requests.reload} />}
      {requests.data && (
        <Card className="divide-y divide-[color:var(--border)]">
          {requests.data.rows.length === 0 && (
            <p className="p-5 text-sm text-muted">{t('hrFix.myLeave.empty')}</p>
          )}
          {requests.data.rows.map((r) => (
            <div key={r.id} className="space-y-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t(LEAVE_TYPE_LABEL[r.type])}</span>
                <Badge tone={TONE[r.status]}>{t(LEAVE_STATUS_LABEL[r.status])}</Badge>
              </div>
              <p className="text-sm text-muted">
                {fmtDate(r.startDate)} – {fmtDate(r.endDate)} ·{' '}
                {t('hrFix.myLeave.workingDays', { days: r.workingDays })}
              </p>
              <p className="text-sm text-muted">{r.reason}</p>
              {r.status === 'REJECTED' && r.decisionNote && (
                <p className="text-sm text-red-600">Alasan penolakan: {r.decisionNote}</p>
              )}
              {(r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HR') && (
                <Button variant="secondary" onClick={() => cancel(r.id)}>
                  {t('hrFix.myLeave.cancel')}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
