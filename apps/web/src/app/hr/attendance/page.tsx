'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/locale-context';
import { Suspense, useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { EmployeeSelect } from '@/components/hr/employee-select';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ATTENDANCE_STATUS_LABEL, fmtDate, fmtTime, type Attendance, type AttendanceStatus, type HrPage } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success', LATE: 'warning', ABSENT: 'danger', LEAVE: 'neutral', HOLIDAY: 'neutral', PENDING: 'warning',
};
// PENDING is produced by the offline queue, never chosen by hand — it stays out of the pickers.
const STATUSES = (Object.keys(ATTENDANCE_STATUS_LABEL) as AttendanceStatus[]).filter((s) => s !== 'PENDING');

/**
 * Offline punches that synced too late to trust the device clock. They count as nothing —
 * payroll and the attendance report skip them — until HR approves or rejects here.
 */
function PendingQueue({ onDecided }: { onDecided: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const { askReason } = useConfirm();
  const { data, error, loading, reload } = useAsync<HrPage<Attendance>>(
    () => api.get<HrPage<Attendance>>(endpoints.hr.attendance({ status: 'PENDING', pageSize: 100 }), true),
    [],
  );

  async function decide(a: Attendance, decision: 'APPROVE' | 'REJECT') {
    const approve = decision === 'APPROVE';
    // Both notes are marked optional in their own labels, so the box is optional here too
    // — but cancelling is still distinguishable from confirming with nothing typed, which
    // `window.prompt` only managed by returning `null` and which every WebView that
    // suppresses prompts got wrong.
    const note = await askReason({
      title: approve ? t('hrFix.attendance.approve') : t('hrFix.attendance.reject'),
      message: approve ? t('hrFix.attendance.approveNote') : t('hrFix.attendance.rejectNote'),
      label: t('common.reason'),
      confirmLabel: approve ? t('hrFix.attendance.approve') : t('hrFix.attendance.reject'),
      tone: approve ? 'primary' : 'danger',
      optional: true,
    });
    if (note === null) return;
    try {
      await api.patch(endpoints.hr.attendanceDecide(a.id), { decision, note: note || undefined }, true);
      toast(decision === 'APPROVE' ? t('hrFix.attendance.approved') : t('hrFix.attendance.rejected'));
      reload();
      onDecided();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.attendance.failed'), 'error'); }
  }

  if (loading) return <Skeleton className="h-24" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.rows.length === 0) return null;

  return (
    <Card className="divide-y divide-[color:var(--border)] border-amber-300">
      <div className="p-3 text-sm font-bold">
        {t('hrFix.attendance.pendingTitle', { count: data.total })}
        <p className="font-normal text-muted">{t('hrFix.attendance.pendingReason')}</p>
      </div>
      {data.rows.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span className="font-medium">{fmtDate(a.workDate)}</span>
          <span className="text-muted">{fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}</span>
          <span className="tabular-nums text-muted">{a.lateMinutes > 0 ? `+${a.lateMinutes}m` : t('hrFix.attendance.onTime')}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => decide(a, 'REJECT')}>{t('hrFix.attendance.reject')}</Button>
            <Button onClick={() => decide(a, 'APPROVE')}>{t('hrFix.attendance.approve')}</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function AttendanceInner() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const { askReason } = useConfirm();
  const isAdmin = canManageHr(customer?.role);
  const employeeId = useSearchParams().get('employeeId') ?? undefined;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // manual entry
  const [mEmp, setMEmp] = useState(employeeId ?? '');
  const [mDate, setMDate] = useState('');
  const [mStatus, setMStatus] = useState<AttendanceStatus>('LEAVE');
  const [mReason, setMReason] = useState('');

  const { data, error, loading, reload } = useAsync<HrPage<Attendance>>(
    () => api.get<HrPage<Attendance>>(endpoints.hr.attendance({ employeeId, from: from || undefined, to: to || undefined, pageSize: 100 }), true),
    [employeeId, from, to],
  );

  async function addManual() {
    if (!mEmp || !mDate) { toast(t('hrFix.attendance.fillIdDate'), 'error'); return; }
    try {
      await api.post(endpoints.hr.attendanceManual, {
        employeeId: mEmp, workDate: new Date(mDate).toISOString(), status: mStatus, reason: mReason || t('hrFix.attendance.manual'),
      }, true);
      toast(t('hrFix.attendance.manualSaved')); setMDate(''); setMReason(''); reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.attendance.failed'), 'error'); }
  }

  async function adjust(a: Attendance, status: AttendanceStatus) {
    if (status === a.status) return;
    // This reason is filed against the attendance row and read back when payroll is
    // questioned, so it is required — and it was the last hardcoded Indonesian string on
    // this screen, which is what happens when copy lives inside a `window.prompt`.
    const reason = await askReason({
      title: t('hrFix.attendance.adjustTitle'),
      message: t('hrFix.attendance.adjustPrompt', { from: a.status, to: status }),
      label: t('common.reason'),
      confirmLabel: t('hrFix.attendance.adjustConfirm'),
    });
    if (!reason) return;
    try {
      await api.patch(endpoints.hr.attendanceAdjust(a.id), { status, reason }, true);
      toast(t('hrFix.attendance.corrected')); reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('hrFix.attendance.failed'), 'error'); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title={t('hrFix.attendance.title')} subtitle={data ? `${data.total} catatan` : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">{t('hrFix.attendance.from')}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">{t('hrFix.attendance.to')}<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      {isAdmin && <PendingQueue onDecided={reload} />}

      {isAdmin && (
        <Card className="flex flex-wrap items-end gap-2 p-4">
          <span className="w-full text-sm font-bold">{t('hrFix.attendance.manualEntry')}</span>
          {/* G-1: manual attendance was typed against a pasted UUID. */}
          <EmployeeSelect value={mEmp} onChange={setMEmp} className="w-56" />
          <label className="text-sm">{t('hrFix.attendance.date')}<Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></label>
          <label className="text-sm">Status
            <select value={mStatus} onChange={(e) => setMStatus(e.target.value as AttendanceStatus)} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{t(ATTENDANCE_STATUS_LABEL[s])}</option>)}
            </select>
          </label>
          <label className="text-sm">{t('hrFix.attendance.reason')}<Input value={mReason} onChange={(e) => setMReason(e.target.value)} className="w-40" /></label>
          <Button onClick={addManual}>{t('hrFix.attendance.save')}</Button>
        </Card>
      )}

      {loading && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">{t('hrFix.attendance.empty')}</Card>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="font-medium">{fmtDate(a.workDate)}</span>
              <span className="text-muted">{fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}</span>
              <span className="tabular-nums text-muted">{a.lateMinutes > 0 ? `+${a.lateMinutes}m` : '—'}</span>
              {isAdmin ? (
                <select
                  value={a.status}
                  onChange={(e) => adjust(a, e.target.value as AttendanceStatus)}
                  aria-label={t('hrFix.attendance.correctStatus')}
                  className="surface-elevated rounded-lg border border-app px-2 py-1 text-xs"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{t(ATTENDANCE_STATUS_LABEL[s])}</option>)}
                </select>
              ) : (
                <Badge tone={TONE[a.status]}>{t(ATTENDANCE_STATUS_LABEL[a.status])}</Badge>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export default function AttendancePage() {
  return <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-4xl" />}><AttendanceInner /></Suspense>;
}
