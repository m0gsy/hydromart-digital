'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/locale-context';
import { Suspense, useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { EmployeeSelect } from '@/components/hr/employee-select';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  ListFooter,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, getBlob } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  ATTENDANCE_STATUS_LABEL,
  fmtDate,
  fmtTime,
  type Attendance,
  type AttendanceAdjustment,
  type AttendanceStatus,
  type HrPage,
} from '@/lib/hr';
import { downloadBlob } from '@/lib/csv';
import { canManageHr } from '@/lib/roles';
import { usePagedList } from '@/lib/use-paged-list';
import { useAsync } from '@/lib/use-async';

/*
 * CA-1-18. Both lists on this screen printed the server's true `total` in their own heading
 * — "Absen menunggu persetujuan (317)" — above 100 rows, with nothing to say the other 217
 * were not below. 100 is the DTO's `@Max`, so the only way past it is a second page.
 */
const PAGE_SIZE = 100;

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
  LEAVE: 'neutral',
  HOLIDAY: 'neutral',
  PENDING: 'warning',
};
// PENDING is produced by the offline queue, never chosen by hand — it stays out of the pickers.
const STATUSES = (Object.keys(ATTENDANCE_STATUS_LABEL) as AttendanceStatus[]).filter(
  (s) => s !== 'PENDING',
);

/**
 * Offline punches that synced too late to trust the device clock. They count as nothing —
 * payroll and the attendance report skip them — until HR approves or rejects here.
 */
function PendingQueue({ onDecided }: { onDecided: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const { askReason } = useConfirm();
  const list = usePagedList<Attendance>(
    (page) =>
      api
        .get<HrPage<Attendance>>(
          endpoints.hr.attendance({ status: 'PENDING', page, pageSize: PAGE_SIZE }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
    [],
  );
  const { error, loading, reload } = list;

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
      await api.patch(
        endpoints.hr.attendanceDecide(a.id),
        { decision, note: note || undefined },
        true,
      );
      toast(
        decision === 'APPROVE' ? t('hrFix.attendance.approved') : t('hrFix.attendance.rejected'),
      );
      reload();
      onDecided();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.attendance.failed'), 'error');
    }
  }

  if (loading && list.rows.length === 0) return <Skeleton className="h-24" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (list.rows.length === 0) return null;

  return (
    <Card className="divide-y divide-[color:var(--border)] border-amber-300">
      <div className="p-3 text-sm font-bold">
        {t('hrFix.attendance.pendingTitle', { count: list.total })}
        <p className="font-normal text-muted">{t('hrFix.attendance.pendingReason')}</p>
      </div>
      {list.rows.map((a) => (
        <div key={a.id} className="p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
          {/* CA-1-01: whose day this is. Approving an attendance row without it is a
              decision taken about a person nobody named. */}
          <span className="min-w-0 flex-1 truncate font-semibold">
            {a.employeeName ?? t('hrFix.attendance.unnamed')}
          </span>
          <span className="font-medium">{fmtDate(a.workDate)}</span>
          <span className="text-muted">
            {fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}
          </span>
          <span className="tabular-nums text-muted">
            {a.lateMinutes > 0 ? `+${a.lateMinutes}m` : t('hrFix.attendance.onTime')}
          </span>
          {/*
            CA-1-66. The face-match score is the ONE anti-fraud signal on this row, and it
            was on the record and on no screen — so an HR officer approved or rejected a
            punch without being told whether the selfie matched the employee at all.

            Null is not zero: null means face matching was off or never ran, which is not
            the same as a photo that scored badly. A percentage only appears when there is
            one to state, and a low one is toned so it is noticed rather than read past.
          */}
          <span className="shrink-0 tabular-nums" title={t('hrFix.attendance.faceScoreLabel')}>
            {a.checkInScore == null ? (
              <span className="text-muted">—</span>
            ) : (
              <span
                className={
                  a.checkInScore < FACE_SCORE_SUSPECT
                    ? 'font-bold text-[color:var(--danger)]'
                    : 'text-muted'
                }
              >
                {Math.round(a.checkInScore * 100)}%
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => decide(a, 'REJECT')}>
              {t('hrFix.attendance.reject')}
            </Button>
            <Button onClick={() => decide(a, 'APPROVE')}>{t('hrFix.attendance.approve')}</Button>
          </div>
          </div>
          {/* The evidence the decision is about, on the screen that takes it. */}
          <PunchProof attendance={a} />
        </div>
      ))}
      <ListFooter
        shown={list.rows.length}
        total={list.total}
        hasMore={list.hasMore}
        onMore={list.loadMore}
        loading={loading}
      />
    </Card>
  );
}

/**
 * CA-1-66 — the face check-in nobody could look at.
 *
 * Every face punch stores a frame and a match score, and neither ever reached a screen. HR
 * approving a pending punch, or correcting a day, decided on evidence it was not shown: the
 * selfie sat in the bucket and the score sat in a column. A low-but-passing match is exactly
 * the row worth a human look, and it was indistinguishable from a perfect one.
 *
 * The frame comes through the API with the session attached, never as a bucket URL.
 */
function PunchProof({ attendance }: { attendance: Attendance }) {
  const { t } = useT();
  const { toast } = useToast();
  const shots: { which: 'in' | 'out'; score: number | null; at: string | null }[] = [
    { which: 'in', score: attendance.checkInScore, at: attendance.checkInAt },
    { which: 'out', score: attendance.checkOutScore, at: attendance.checkOutAt },
  ];
  const shown = shots.filter((s) => s.score !== null);
  if (shown.length === 0) return null;

  async function open(which: 'in' | 'out') {
    try {
      const blob = await getBlob(endpoints.hr.attendancePhoto(attendance.id, which));
      downloadBlob(`absensi-${attendance.workDate}-${which}`, blob);
    } catch (e) {
      // A manual entry, or a row written against an older bucket, has no frame to show.
      toast(e instanceof ApiError ? e.message : t('hrFix.attendance.photoFailed'), 'error');
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
      {shown.map((s) => (
        <button
          key={s.which}
          type="button"
          onClick={() => void open(s.which)}
          className="rounded-lg border border-app px-2 py-1 font-medium hover:underline"
        >
          {s.which === 'in' ? t('hrFix.attendance.photoIn') : t('hrFix.attendance.photoOut')} ·{' '}
          {t('hrFix.attendance.matchScore', { score: Math.round((s.score ?? 0) * 100) })}
        </button>
      ))}
    </div>
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

  const list = usePagedList<Attendance>(
    (page) =>
      api
        .get<HrPage<Attendance>>(
          endpoints.hr.attendance({
            employeeId,
            from: from || undefined,
            to: to || undefined,
            page,
            pageSize: PAGE_SIZE,
          }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
    [employeeId, from, to],
  );
  const { error, loading, reload } = list;

  async function addManual() {
    if (!mEmp || !mDate) {
      toast(t('hrFix.attendance.fillIdDate'), 'error');
      return;
    }
    try {
      await api.post(
        endpoints.hr.attendanceManual,
        {
          employeeId: mEmp,
          workDate: new Date(mDate).toISOString(),
          status: mStatus,
          reason: mReason || t('hrFix.attendance.manual'),
        },
        true,
      );
      toast(t('hrFix.attendance.manualSaved'));
      setMDate('');
      setMReason('');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.attendance.failed'), 'error');
    }
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
      toast(t('hrFix.attendance.corrected'));
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.attendance.failed'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader
        title={t('hrFix.attendance.title')}
        subtitle={list.rows.length > 0 ? `${list.total} catatan` : undefined}
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          {t('hrFix.attendance.from')}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          {t('hrFix.attendance.to')}
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {isAdmin && <PendingQueue onDecided={reload} />}

      {isAdmin && (
        <Card className="flex flex-wrap items-end gap-2 p-4">
          <span className="w-full text-sm font-bold">{t('hrFix.attendance.manualEntry')}</span>
          {/* G-1: manual attendance was typed against a pasted UUID. */}
          <EmployeeSelect value={mEmp} onChange={setMEmp} className="w-56" />
          <label className="text-sm">
            {t('hrFix.attendance.date')}
            <Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
          </label>
          <label className="text-sm">
            Status
            <select
              value={mStatus}
              onChange={(e) => setMStatus(e.target.value as AttendanceStatus)}
              className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(ATTENDANCE_STATUS_LABEL[s])}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t('hrFix.attendance.reason')}
            <Input value={mReason} onChange={(e) => setMReason(e.target.value)} className="w-40" />
          </label>
          <Button onClick={addManual}>{t('hrFix.attendance.save')}</Button>
        </Card>
      )}

      {loading && list.rows.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && list.rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">{t('hrFix.attendance.empty')}</Card>
      )}
      {list.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {list.rows.map((a) => (
            <div key={a.id} className="p-3 text-sm">
            {/*
              * CA-1-57 — five items on one un-wrapping row. On a phone the status select
              * at the end was pushed off the edge, so the control that CORRECTS a day's
              * attendance was unreachable on the device HR actually carries.
              *
              * `gap-y-1` rather than the row's `gap-3`: a wrapped second line separated by
              * 12px reads as a second record.
              */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1 truncate font-semibold">
                {a.employeeName ?? t('hrFix.attendance.unnamed')}
              </span>
              <span className="font-medium">{fmtDate(a.workDate)}</span>
              <span className="text-muted">
                {fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}
              </span>
              <span className="tabular-nums text-muted">
                {a.lateMinutes > 0 ? `+${a.lateMinutes}m` : '—'}
              </span>
              {isAdmin ? (
                <select
                  value={a.status}
                  onChange={(e) => adjust(a, e.target.value as AttendanceStatus)}
                  aria-label={t('hrFix.attendance.correctStatus')}
                  className="surface-elevated rounded-lg border border-app px-2 py-1 text-xs"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(ATTENDANCE_STATUS_LABEL[s])}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge tone={TONE[a.status]}>{t(ATTENDANCE_STATUS_LABEL[a.status])}</Badge>
              )}
            </div>
            {/* CA-1-24: the corrections filed against this row. Written since the
                correction path existed and readable from nowhere — so the trail that
                exists to answer "why does this payslip say that" could only be reached by
                opening the database. Only for HR, and only on demand: a row nobody has
                questioned does not need its history fetched. */}
            <PunchProof attendance={a} />
            {isAdmin && <AdjustmentTrail attendanceId={a.id} />}
            </div>
          ))}
        </Card>
      )}
      <ListFooter
        shown={list.rows.length}
        total={list.total}
        hasMore={list.hasMore}
        onMore={list.loadMore}
        loading={loading}
      />
    </div>
  );
}

/**
 * CA-1-24 — the corrections filed against one attendance row.
 *
 * Collapsed and unfetched until asked. A page of thirty rows must not fire thirty audit
 * reads for a question nobody has asked yet, and the trail is only interesting about the
 * one row somebody is disputing.
 */
function AdjustmentTrail({ attendanceId }: { attendanceId: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const trail = useAsync<AttendanceAdjustment[]>(
    () =>
      open
        ? api.get(endpoints.hr.attendanceAdjustments(attendanceId), true)
        : Promise.resolve([]),
    [attendanceId, open],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-[11.5px] font-bold text-brand-700 hover:underline"
      >
        {t('hrFix.attendance.trailShow')}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-app p-2.5">
      {trail.loading ? (
        <Skeleton className="h-10 w-full" />
      ) : trail.error ? (
        <ErrorState message={trail.error} onRetry={trail.reload} />
      ) : (trail.data ?? []).length === 0 ? (
        <p className="text-[11.5px] text-muted">{t('hrFix.attendance.trailEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {(trail.data ?? []).map((row) => (
            <li key={row.id} className="text-[11.5px] leading-snug">
              <span className="font-bold">{fmtDate(row.createdAt)}</span>
              {' · '}
              <span>{row.reason}</span>
              {/* The before/after snapshots are the reason these rows are kept: a status
                  that changed is the fact somebody is disputing. */}
              {statusOf(row.before) && statusOf(row.after) && (
                <span className="text-muted">
                  {' — '}
                  {statusOf(row.before)} → {statusOf(row.after)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The snapshots are stored as JSON, so the status is read defensively, not cast. */
function statusOf(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const status = (snapshot as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

/**
 * CA-1-66: below this, a face match is worth a second look rather than a nod. Deliberately
 * a DISPLAY threshold, not a decision — the server owns whether a punch is accepted, and a
 * number here that pretended to be the rule would drift from it silently.
 */
const FACE_SCORE_SUSPECT = 0.75;

export default function AttendancePage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-4xl" />}>
      <AttendanceInner />
    </Suspense>
  );
}
