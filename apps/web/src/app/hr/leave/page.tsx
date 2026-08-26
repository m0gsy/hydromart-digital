'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  LinkButton,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  fmtDate,
  type HrPage,
  type LeaveRequest,
  type LeaveStatus,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const TONE: Record<LeaveStatus, 'success' | 'neutral' | 'danger' | 'brand'> = {
  PENDING_MANAGER: 'brand',
  PENDING_HR: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/**
 * Approval queue. Stage 1 is the depot manager, stage 2 is HR — the row itself says which
 * decision it is waiting for, so one screen serves both.
 */
export default function LeaveQueuePage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const isHr = canManageHr(customer?.role);
  const [status, setStatus] = useState<LeaveStatus | ''>('PENDING_MANAGER');
  const [note, setNote] = useState<Record<string, string>>({});

  const queue = useAsync<HrPage<LeaveRequest>>(
    () =>
      api.get<HrPage<LeaveRequest>>(endpoints.hr.leaveQueue({ status: status || undefined }), true),
    [status],
  );

  async function decide(row: LeaveRequest, approve: boolean) {
    const url =
      row.status === 'PENDING_MANAGER'
        ? endpoints.hr.leaveManagerDecision(row.id)
        : endpoints.hr.leaveHrDecision(row.id);
    try {
      await api.patch(url, { approve, note: note[row.id]?.trim() || undefined }, true);
      toast(approve ? t('hrFix.leave.approved') : t('hrFix.leave.rejected'));
      queue.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.leave.failed'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('hrFix.leave.title')}
        subtitle={t('hrFix.leave.subtitle')}
        action={
          isHr ? (
            <LinkButton href="/hr/leave/balances-import" variant="secondary">
              {t('hrFix.leave.importBalances')}
            </LinkButton>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as LeaveStatus | '')}
          className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">{t('hrFix.leave.allStatuses')}</option>
          {(Object.keys(LEAVE_STATUS_LABEL) as LeaveStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(LEAVE_STATUS_LABEL[s])}
            </option>
          ))}
        </select>
      </div>

      {queue.loading && <Skeleton className="h-32" />}
      {queue.error && <ErrorState message={queue.error} onRetry={queue.reload} />}
      {queue.data && queue.data.rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">{t('hrFix.leave.empty')}</Card>
      )}
      {queue.data && queue.data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {queue.data.rows.map((r) => {
            const waitingHr = r.status === 'PENDING_HR';
            const actionable =
              (r.status === 'PENDING_MANAGER' || waitingHr) && (isHr || !waitingHr);
            return (
              <div key={r.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  {/* PG-06: whose leave this is. The row said the type, the dates and the
                      reason, and offered Approve / Reject — with nothing naming the person
                      whose leave was being decided. */}
                  <span className="font-semibold">
                    {r.employeeName ?? t('hrFix.payroll.unnamedEmployee')}
                  </span>
                  <Badge tone={TONE[r.status]}>{t(LEAVE_STATUS_LABEL[r.status])}</Badge>
                </div>
                <p className="text-sm font-medium">{t(LEAVE_TYPE_LABEL[r.type])}</p>
                <p className="text-sm text-muted">
                  {fmtDate(r.startDate)} – {fmtDate(r.endDate)} · {r.workingDays} hari kerja
                </p>
                <p className="text-sm">{r.reason}</p>
                {r.decisionNote && <p className="text-sm text-muted">Catatan: {r.decisionNote}</p>}
                {actionable && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={note[r.id] ?? ''}
                      onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                      placeholder={t('hrFix.leave.noteHint')}
                      className="max-w-xs"
                    />
                    <Button onClick={() => decide(r, true)}>{t('hrFix.leave.approve')}</Button>
                    <Button variant="secondary" onClick={() => decide(r, false)}>
                      {t('hrFix.leave.reject2')}
                    </Button>
                  </div>
                )}
                {waitingHr && !isHr && <p className="text-xs text-muted">{t('hrFix.leave.awaitingHr')}</p>}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
