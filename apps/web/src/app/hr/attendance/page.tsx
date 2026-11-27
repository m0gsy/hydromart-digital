'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/locale-context';
import { Suspense, useId, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

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
  Segmented,
  Skeleton,
  LinkButton,
} from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, getBlob } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import {
  ATTENDANCE_STATUS_LABEL,
  fmtDate,
  fmtTime,
  punchShots,
  type Attendance,
  type AttendanceAdjustment,
  type AttendanceStatus,
  type HrPage,
} from '@/lib/hr';
import { downloadBlob } from '@/lib/csv';
import { canManageHr } from '@/lib/roles';
import { usePagedList } from '@/lib/use-paged-list';
import { useAsync } from '@/lib/use-async';
import { dateInDaysWib, todayWib } from '@/lib/wib';

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

/** The widest window hr-service accepts (`@IsWithinDays`, MAX_RANGE_DAYS in @hydromart/platform). */
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

const FIELD = 'flex min-w-0 flex-col gap-1 text-sm font-medium';
const SELECT =
  'surface-elevated min-h-11 w-full min-w-0 rounded-lg border border-app px-3 py-2 text-sm';

/** `YYYY-MM-DD` moved by `n` calendar days, reckoned in WIB like every other day on this screen. */
function shiftDay(day: string, n: number): string {
  return dateInDaysWib(n, new Date(`${day}T00:00:00+07:00`));
}

/**
 * The depot an attendance row was recorded at (owner, 27 Nov 2026). hr-service copies it from the
 * employee at the punch, so a day keeps the depot it was worked at after the person moves or is
 * lent out. Null is somebody above any single depot (SPV and up), not an unknown depot.
 *
 * Names come from the depots this account may see (`GET /depots/scope`, already loaded by the
 * console). An id outside that list shows as its short form rather than as nothing.
 */
function useDepotLabel(): (depotId: string | null) => string {
  const { t } = useT();
  const { depots } = useDepot();
  return (depotId) =>
    depotId === null
      ? t('hrFix.attendance.noDepot')
      : (depots.find((d) => d.id === depotId)?.name ?? depotId.slice(0, 8));
}

/**
 * Offline punches that synced too late to trust the device clock. They count as nothing —
 * payroll and the attendance report skip them — until HR approves or rejects here.
 */
function PendingQueue({ onDecided }: { onDecided: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const { askReason } = useConfirm();
  const depotLabel = useDepotLabel();
  // Not narrowed by the date or depot filter below: this is the work waiting on HR, and a punch
  // filtered out of sight here is a punch nobody decides.
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
    <Card className="divide-y divide-[color:var(--border)] border-[color:var(--warning)]">
      <div className="p-3 text-sm font-bold">
        {t('hrFix.attendance.pendingTitle', { count: list.total })}
        <p className="font-normal text-muted">{t('hrFix.attendance.pendingReason')}</p>
        {/* 2026-11-18: the third reason a punch waits here. Said always: a row it applies to may
            sit past the first page of the queue. */}
        <p className="font-normal text-muted">{t('hrFix.attendance.pendingReasonFace')}</p>
      </div>
      {list.rows.map((a) => (
        <div key={a.id} className="p-3 text-sm">
          {/* CA-1-01: whose day this is. Approving an attendance row without it is a
              decision taken about a person nobody named. */}
          <p className="truncate font-semibold">{a.employeeName ?? t('hrFix.attendance.unnamed')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span className="font-medium text-[color:var(--text)]">{fmtDate(a.workDate)}</span>
            <span>{depotLabel(a.depotId)}</span>
            <span>
              {fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}
            </span>
            <span className="tabular-nums">
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
            <span className="tabular-nums" title={t('hrFix.attendance.faceScoreLabel')}>
              {a.checkInScore == null ? (
                <span>—</span>
              ) : (
                <span
                  className={
                    a.checkInScore < FACE_SCORE_SUSPECT ? 'font-bold text-[color:var(--danger)]' : ''
                  }
                >
                  {Math.round(a.checkInScore * 100)}%
                </span>
              )}
            </span>
          </div>
          {/* The evidence the decision is about, on the screen that takes it. */}
          <PunchProof attendance={a} />
          {/* Their own line, under the evidence: beside the name on a phone they squeezed the
              name down to a few letters. */}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => decide(a, 'REJECT')}>
              {t('hrFix.attendance.reject')}
            </Button>
            <Button onClick={() => decide(a, 'APPROVE')}>{t('hrFix.attendance.approve')}</Button>
          </div>
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
  const shown = punchShots(attendance);
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
          {s.score === null
            ? t('hrFix.attendance.matchUnverified')
            : t('hrFix.attendance.matchScore', { score: Math.round(s.score * 100) })}
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
  const { depots } = useDepot();
  const depotLabel = useDepotLabel();
  const dayInputId = useId();
  const params = useSearchParams();
  const employeeId = params.get('employeeId') ?? undefined;
  /*
   * Owner, 27 Nov 2026: the menu opens on one day — today — because "who came in, at which
   * depot" is the question it is opened for. A link that names a person or a window (an
   * employee's history, PR-2b's payroll slip with `?from=&to=`) opens on what it named instead,
   * which is the range mode with the old empty-means-everything default.
   */
  const linked = employeeId !== undefined || params.has('from') || params.has('to');
  const [mode, setMode] = useState<'day' | 'range'>(linked ? 'range' : 'day');
  const [day, setDay] = useState(() => todayWib());
  const [from, setFrom] = useState(() => params.get('from') ?? '');
  const [to, setTo] = useState(() => params.get('to') ?? '');
  const [depotId, setDepotId] = useState('');

  const span = mode === 'day' ? { from: day, to: day } : { from, to };
  // Refused here, in words, rather than sent for hr-service's 400 (`@IsNotBefore`, `@IsWithinDays`).
  const rangeError =
    span.from && span.to && span.from > span.to
      ? t('hrFix.attendance.badRange')
      : span.from && span.to && Date.parse(span.to) - Date.parse(span.from) > MAX_RANGE_DAYS * DAY_MS
        ? t('hrFix.attendance.rangeTooLong', { days: MAX_RANGE_DAYS })
        : null;

  // manual entry
  const [mEmp, setMEmp] = useState(employeeId ?? '');
  const [mDate, setMDate] = useState('');
  const [mStatus, setMStatus] = useState<AttendanceStatus>('LEAVE');
  const [mReason, setMReason] = useState('');

  const list = usePagedList<Attendance>(
    (page) =>
      rangeError
        ? Promise.resolve({ items: [], total: 0 })
        : api
            .get<HrPage<Attendance>>(
              endpoints.hr.attendance({
                employeeId,
                depotId: depotId || undefined,
                from: span.from || undefined,
                to: span.to || undefined,
                page,
                pageSize: PAGE_SIZE,
              }),
              true,
            )
            .then((p) => ({ items: p.rows, total: p.total })),
    [employeeId, depotId, span.from, span.to, rangeError],
  );
  const { error, loading, reload } = list;

  function pickMode(next: 'day' | 'range') {
    // Into a range from a day: start the range ON that day rather than on everything.
    if (next === 'range' && !from && !to) {
      setFrom(day);
      setTo(day);
    }
    setMode(next);
  }

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
        action={
          isAdmin ? (
            <LinkButton href="/hr/attendance/import" variant="secondary">
              {t('hrFix.imports.attendanceTitle')}
            </LinkButton>
          ) : undefined
        }
      />
      <Card className="flex flex-col gap-3 p-4">
        <Segmented
          label={t('hrFix.attendance.dateMode')}
          value={mode}
          options={[
            { value: 'day', label: t('hrFix.attendance.modeDay') },
            { value: 'range', label: t('hrFix.attendance.modeRange') },
          ]}
          onChange={pickMode}
          className="self-start"
        />
        {/* One column on a phone, the fields side by side once there is room. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mode === 'day' ? (
            <div className={FIELD}>
              <label htmlFor={dayInputId}>{t('hrFix.attendance.date')}</label>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  aria-label={t('hrFix.attendance.prevDay')}
                  onClick={() => setDay(shiftDay(day, -1))}
                  className="shrink-0 px-3"
                >
                  <CaretLeft size={16} weight="bold" aria-hidden />
                </Button>
                <Input
                  id={dayInputId}
                  type="date"
                  value={day}
                  // A cleared box keeps the day it had: "no day" is what the range mode is for.
                  onChange={(e) => e.target.value && setDay(e.target.value)}
                  className="min-w-0"
                />
                <Button
                  variant="secondary"
                  aria-label={t('hrFix.attendance.nextDay')}
                  onClick={() => setDay(shiftDay(day, 1))}
                  className="shrink-0 px-3"
                >
                  <CaretRight size={16} weight="bold" aria-hidden />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <label className={FIELD}>
                {t('hrFix.attendance.from')}
                <Input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className={FIELD}>
                {t('hrFix.attendance.to')}
                <Input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          )}
          <label className={FIELD}>
            {t('hrFix.attendance.depot')}
            <select value={depotId} onChange={(e) => setDepotId(e.target.value)} className={SELECT}>
              <option value="">{t('hrFix.attendance.allDepots')}</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.code}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rangeError && (
          <p role="alert" className="text-sm font-medium text-[color:var(--danger)]">
            {rangeError}
          </p>
        )}
      </Card>

      {isAdmin && <PendingQueue onDecided={reload} />}

      {isAdmin && (
        <Card className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2">
          <span className="text-sm font-bold sm:col-span-2">{t('hrFix.attendance.manualEntry')}</span>
          {/* G-1: manual attendance was typed against a pasted UUID. */}
          <EmployeeSelect value={mEmp} onChange={setMEmp} className="w-full" />
          <label className={FIELD}>
            {t('hrFix.attendance.date')}
            <Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
          </label>
          <label className={FIELD}>
            Status
            <select
              value={mStatus}
              onChange={(e) => setMStatus(e.target.value as AttendanceStatus)}
              className={SELECT}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(ATTENDANCE_STATUS_LABEL[s])}
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD}>
            {t('hrFix.attendance.reason')}
            <Input value={mReason} onChange={(e) => setMReason(e.target.value)} />
          </label>
          <Button onClick={addManual} className="sm:col-span-2 sm:justify-self-end">
            {t('hrFix.attendance.save')}
          </Button>
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
      {!loading && !error && !rangeError && list.rows.length === 0 && (
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
              * Two lines since 27 Nov 2026, when the depot joined the row: who and the
              * status control on the first (the name gives way, the control never does),
              * the facts of the day on the second.
              */}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate font-semibold">
                {a.employeeName ?? t('hrFix.attendance.unnamed')}
              </span>
              {/* A PENDING punch is decided in the queue above. Its status is not one of the
                  corrections offered, so a select here would show the first option instead. */}
              {isAdmin && a.status !== 'PENDING' ? (
                <select
                  value={a.status}
                  onChange={(e) => adjust(a, e.target.value as AttendanceStatus)}
                  aria-label={t('hrFix.attendance.correctStatus')}
                  className="surface-elevated min-h-11 shrink-0 rounded-lg border border-app px-2 text-xs"
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
            {/* `gap-y-1`: a wrapped line separated by 12px reads as a second record. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              <span className="font-medium text-[color:var(--text)]">{fmtDate(a.workDate)}</span>
              <span>{depotLabel(a.depotId)}</span>
              <span>
                {fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}
              </span>
              <span className="tabular-nums">{a.lateMinutes > 0 ? `+${a.lateMinutes}m` : '—'}</span>
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
