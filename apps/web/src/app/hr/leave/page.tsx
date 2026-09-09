'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { EmployeeSelect } from '@/components/hr/employee-select';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  LinkButton,
  ListFooter,
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
  type LeaveType,
} from '@/lib/hr';
import { can, canManageHr } from '@/lib/roles';
import { usePagedList } from '@/lib/use-paged-list';

/** The server's own default page for this endpoint; named here so the footer's count means something. */
const PAGE_SIZE = 20;

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
/**
 * CA-1-44 — HR could not file leave for anybody but itself.
 *
 * The only way in was `POST /leave`, which resolves the applicant from the session, so an
 * application could only ever come from the person taking the leave. That excludes the two
 * groups who need it most: staff whose employee record has no login at all, and the courier
 * who phones in sick at 5am. HR took that call and had nowhere to write it down, so the day
 * was entered as an ABSENT correction and the leave ledger never saw it.
 *
 * It joins the ordinary queue. Filing is not approving, and who may approve is not a
 * decision this form is entitled to change.
 */
function FileForEmployee({ onFiled }: { onFiled: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<LeaveType>('SICK');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function file(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !startDate || !endDate || !reason.trim()) {
      toast(t('hrFix.leave.fileFillAll'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(
        endpoints.hr.leaveOnBehalf,
        { employeeId, type, startDate, endDate, reason: reason.trim() },
        true,
      );
      toast(t('hrFix.leave.filed'));
      setEmployeeId('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setOpen(false);
      onFiled();
    } catch (e2) {
      // The server's own sentence is the useful one: an overlapping request, or a quota
      // that will not stretch, is a fact the person filing has to hear exactly.
      toast(e2 instanceof ApiError ? e2.message : t('hrFix.leave.fileFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('hrFix.leave.fileForEmployee')}
      </Button>
    );
  }
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-bold">{t('hrFix.leave.fileForEmployee')}</h3>
      <form onSubmit={file} className="grid gap-3 sm:grid-cols-2">
        <EmployeeSelect
          value={employeeId}
          onChange={setEmployeeId}
          label={t('hrFix.leave.fileEmployee')}
          className="sm:col-span-2"
        />
        <label className="text-sm font-medium">
          {t('hrFix.leave.fileType')}
          <select
            value={type}
            onChange={(e) => setType(e.target.value as LeaveType)}
            className="surface-elevated mt-1 w-full rounded-lg border border-app px-3 py-2.5 text-sm"
          >
            {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((ty) => (
              <option key={ty} value={ty}>
                {t(LEAVE_TYPE_LABEL[ty])}
              </option>
            ))}
          </select>
        </label>
        <div />
        <label className="text-sm font-medium">
          {t('hrFix.leave.fileStart')}
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="text-sm font-medium">
          {t('hrFix.leave.fileEnd')}
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t('hrFix.leave.fileReason')}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={busy}>
            {t('hrFix.leave.fileSubmit')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('hrFix.leave.fileCancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function LeaveQueuePage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const isHr = canManageHr(customer?.role);
  /*
   * CA-1-28. Stage one was gated on the STAGE, not on the reader: `!waitingHr` is true for
   * every PENDING_MANAGER row, so the Approve and Reject buttons were drawn for anybody who
   * could open this queue — including roles without `leaveApprove`. The server refuses them,
   * so the only thing the buttons could produce was a 403 after the decision had been made
   * in the reader's head.
   *
   * The same capability hr-service checks on the route, so the buttons are offered to
   * exactly the roles it will serve and to nobody else.
   */
  const mayApprove = can('leaveApprove', customer?.role);
  const [status, setStatus] = useState<LeaveStatus | ''>('PENDING_MANAGER');
  const [note, setNote] = useState<Record<string, string>>({});

  /*
   * CA-1-16. This asked for the queue with no page at all, so it got the server's default
   * first 20 and there was no second page to ask for. An approvals queue is not a preview:
   * application 21 is not further down the screen, it is absent from it, and the person
   * waiting on that decision has no way to tell that nobody ever saw their form.
   */
  const queue = usePagedList<LeaveRequest>(
    (page) =>
      api
        .get<HrPage<LeaveRequest>>(
          endpoints.hr.leaveQueue({ status: status || undefined, page, pageSize: PAGE_SIZE }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
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

      {isHr && <FileForEmployee onFiled={() => queue.reload()} />}

      <div className="flex flex-wrap gap-3">
        <select
          aria-label={t('hrFix.leave.allStatuses')}
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

      {queue.loading && queue.rows.length === 0 && <Skeleton className="h-32" />}
      {queue.error && <ErrorState message={queue.error} onRetry={queue.reload} />}
      {!queue.loading && !queue.error && queue.rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">{t('hrFix.leave.empty')}</Card>
      )}
      {queue.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {queue.rows.map((r) => {
            const waitingHr = r.status === 'PENDING_HR';
            const actionable =
              mayApprove && (r.status === 'PENDING_MANAGER' || waitingHr) && (isHr || !waitingHr);
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
                  {fmtDate(r.startDate)} – {fmtDate(r.endDate)} ·{' '}
                  {t('hrFix.leave.workingDays', { days: r.workingDays })}
                </p>
                <p className="text-sm">{r.reason}</p>
                {r.decisionNote && (
                  <p className="text-sm text-muted">
                    {t('hrFix.leave.note', { note: r.decisionNote })}
                  </p>
                )}
                {actionable && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* CA-1-78: one of these per pending request, so the name has to say
                        WHICH request — a dozen fields all called "Catatan" is the same as a
                        dozen unnamed ones. */}
                    <Input
                      aria-label={t('hrFix.leave.noteFor', { name: r.employeeName ?? r.employeeId })}
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
                {waitingHr && !isHr && (
                  <p className="text-xs text-muted">{t('hrFix.leave.awaitingHr')}</p>
                )}
              </div>
            );
          })}
        </Card>
      )}
      <ListFooter
        shown={queue.rows.length}
        total={queue.total}
        hasMore={queue.hasMore}
        onMore={queue.loadMore}
        loading={queue.loading}
      />
    </div>
  );
}
