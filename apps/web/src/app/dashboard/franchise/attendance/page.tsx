'use client';

import { useState } from 'react';
import { UsersThree } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, CenterState, ErrorState, Input, ListFooter, Skeleton } from '@/components/ui';
import { api, ApiError, getBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { ATTENDANCE_STATUS_LABEL, fmtDate, fmtTime, type Attendance, type AttendanceStatus, type HrPage } from '@/lib/hr';
import { useT } from '@/lib/locale-context';
import { canViewOwnAttendance } from '@/lib/roles';
import { usePagedList } from '@/lib/use-paged-list';
import { useAsync } from '@/lib/use-async';
import { monthWib, todayWib } from '@/lib/wib';

const PAGE_SIZE = 50;

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
  LEAVE: 'neutral',
  HOLIDAY: 'neutral',
  PENDING: 'warning',
};

interface OwnedDepot {
  id: string;
  name: string | null;
}

interface DepotSummary {
  depotId: string;
  depotName: string | null;
  present: number;
  late: number;
  absent: number;
  leave: number;
  holiday: number;
  pending: number;
  lateMinutes: number;
  employees: number;
}

interface Summary {
  from: string;
  to: string;
  depots: DepotSummary[];
}

/** The frame behind a punch, shown inline. It arrives through the API with the session attached. */
function PunchPhotos({ attendance }: { attendance: Attendance }) {
  const { t } = useT();
  const { toast } = useToast();
  const [shown, setShown] = useState<{ which: 'in' | 'out'; url: string } | null>(null);
  const shots: { which: 'in' | 'out'; score: number | null }[] = [
    { which: 'in', score: attendance.checkInScore },
    { which: 'out', score: attendance.checkOutScore },
  ];
  const withFrame = shots.filter((s) => s.score !== null);
  if (withFrame.length === 0) return <span className="text-muted">—</span>;

  async function open(which: 'in' | 'out') {
    if (shown) URL.revokeObjectURL(shown.url);
    try {
      const blob = await getBlob(endpoints.hr.ownerAttendancePhoto(attendance.id, which));
      setShown({ which, url: URL.createObjectURL(blob) });
    } catch (e) {
      // A manual entry, or a row older than the retention window, has no frame to show.
      setShown(null);
      toast(e instanceof ApiError ? e.message : t('hrFix.ownerAttendance.photoFailed'), 'error');
    }
  }

  function close() {
    if (shown) URL.revokeObjectURL(shown.url);
    setShown(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {withFrame.map((s) => (
          <button
            key={s.which}
            type="button"
            onClick={() => void open(s.which)}
            className="min-h-11 rounded-lg border border-app px-2 py-1 text-xs font-medium hover:underline"
          >
            {s.which === 'in' ? t('hrFix.ownerAttendance.photoIn') : t('hrFix.ownerAttendance.photoOut')} ·{' '}
            {Math.round((s.score ?? 0) * 100)}%
          </button>
        ))}
      </div>
      {shown && (
        <div className="flex flex-col items-start gap-2">
          <img
            src={shown.url}
            alt={t('hrFix.ownerAttendance.photoAlt')}
            className="max-h-56 max-w-full rounded-xl border border-app object-contain"
          />
          <Button variant="ghost" onClick={close}>
            {t('hrFix.ownerAttendance.closePhoto')}
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryCards({ summary }: { summary: Summary }) {
  const { t } = useT();
  const totals = summary.depots.reduce(
    (a, d) => ({
      present: a.present + d.present,
      late: a.late + d.late,
      absent: a.absent + d.absent,
      leave: a.leave + d.leave,
      pending: a.pending + d.pending,
      lateMinutes: a.lateMinutes + d.lateMinutes,
    }),
    { present: 0, late: 0, absent: 0, leave: 0, pending: 0, lateMinutes: 0 },
  );
  const cell = (label: string, value: number, tone?: 'danger' | 'warning') => (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={
          'text-xl font-bold tabular-nums ' +
          (value > 0 && tone === 'danger' ? 'text-[color:var(--danger)]' : value > 0 && tone === 'warning' ? 'text-[color:var(--warning)]' : '')
        }
      >
        {value}
      </p>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {summary.depots.length > 1 && (
        <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {cell(t('hrFix.ownerAttendance.present'), totals.present)}
          {cell(t('hrFix.ownerAttendance.late'), totals.late, 'warning')}
          {cell(t('hrFix.ownerAttendance.absent'), totals.absent, 'danger')}
          {cell(t('hrFix.ownerAttendance.leave'), totals.leave)}
          {cell(t('hrFix.ownerAttendance.pending'), totals.pending, 'warning')}
          {cell(t('hrFix.ownerAttendance.lateMinutes'), totals.lateMinutes)}
        </Card>
      )}
      {summary.depots.map((d) => (
        <Card key={d.depotId} className="flex flex-col gap-3 p-4">
          <p className="font-semibold">
            {d.depotName ?? d.depotId.slice(0, 8)}{' '}
            <span className="text-xs font-normal text-muted">
              · {t('hrFix.ownerAttendance.people', { n: d.employees })}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cell(t('hrFix.ownerAttendance.present'), d.present)}
            {cell(t('hrFix.ownerAttendance.late'), d.late, 'warning')}
            {cell(t('hrFix.ownerAttendance.absent'), d.absent, 'danger')}
            {cell(t('hrFix.ownerAttendance.leave'), d.leave)}
            {cell(t('hrFix.ownerAttendance.pending'), d.pending, 'warning')}
            {cell(t('hrFix.ownerAttendance.lateMinutes'), d.lateMinutes)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function OwnerAttendanceBody() {
  const { t } = useT();
  const today = todayWib();
  const [from, setFrom] = useState(`${monthWib()}-01`);
  const [to, setTo] = useState(today);
  const [depotId, setDepotId] = useState('');
  const [status, setStatus] = useState('');

  const depots = useAsync<OwnedDepot[]>(() => api.get(endpoints.hr.ownerAttendanceDepots, true));
  const rangeOk = from !== '' && to !== '' && from <= to;
  const summary = useAsync<Summary | null>(
    () =>
      rangeOk
        ? api.get<Summary>(
            endpoints.hr.ownerAttendanceSummary({ from, to, depotId: depotId || undefined }),
            true,
          )
        : Promise.resolve(null),
    [from, to, depotId, rangeOk],
  );
  const list = usePagedList<Attendance>(
    (page) =>
      rangeOk
        ? api
            .get<HrPage<Attendance>>(
              endpoints.hr.ownerAttendance({
                depotId: depotId || undefined,
                status: status || undefined,
                from,
                to,
                page,
                pageSize: PAGE_SIZE,
              }),
              true,
            )
            .then((p) => ({ items: p.rows, total: p.total }))
        : Promise.resolve({ items: [], total: 0 }),
    [from, to, depotId, status, rangeOk],
  );

  const owned = depots.data ?? [];
  const nameOf = (id: string) => owned.find((d) => d.id === id)?.name ?? id.slice(0, 8);
  const selectCls = 'surface-elevated min-h-11 w-full min-w-0 rounded-lg border border-app px-3 py-2 text-sm';

  if (depots.loading) return <Skeleton className="h-64 w-full" />;
  if (depots.error) return <ErrorState message={depots.error} onRetry={depots.reload} />;
  if (owned.length === 0) {
    return (
      <CenterState title={t('hrFix.ownerAttendance.noDepotTitle')}>
        {t('hrFix.ownerAttendance.noDepotBody')}
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2">
          <UsersThree size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('hrFix.ownerAttendance.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('hrFix.ownerAttendance.subtitle')}</p>
      </div>

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t('hrFix.ownerAttendance.depot')}
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)} className={selectCls}>
            <option value="">{t('hrFix.ownerAttendance.allDepots')}</option>
            {owned.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name ?? d.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t('hrFix.ownerAttendance.from')}
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t('hrFix.ownerAttendance.to')}
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t('hrFix.ownerAttendance.status')}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">{t('hrFix.ownerAttendance.allStatus')}</option>
            {(Object.keys(ATTENDANCE_STATUS_LABEL) as AttendanceStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(`hrFix.ownerAttendance.s.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {!rangeOk && (
          <p className="text-sm font-medium text-[color:var(--danger)] sm:col-span-2 lg:col-span-4" role="alert">
            {t('hrFix.ownerAttendance.badRange')}
          </p>
        )}
      </Card>

      {summary.loading && !summary.data ? (
        <Skeleton className="h-28 w-full" />
      ) : summary.error ? (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      ) : summary.data ? (
        <SummaryCards summary={summary.data} />
      ) : null}

      <Card className="divide-y divide-[color:var(--border)] p-0">
        {list.error ? (
          <div className="p-4">
            <ErrorState message={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading && list.rows.length === 0 ? (
          <Skeleton className="h-40 w-full" />
        ) : list.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('hrFix.ownerAttendance.empty')}</p>
        ) : (
          list.rows.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {a.employeeName ?? t('hrFix.ownerAttendance.unnamed')}
                </span>
                <Badge tone={TONE[a.status]}>{t(`hrFix.ownerAttendance.s.${a.status}`)}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
                <span className="font-medium text-[color:var(--text)]">{fmtDate(a.workDate)}</span>
                <span>{nameOf(a.depotId)}</span>
                <span>
                  {fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}
                </span>
                <span className="tabular-nums">
                  {a.lateMinutes > 0 ? `+${a.lateMinutes}m` : t('hrFix.ownerAttendance.onTime')}
                </span>
              </div>
              <PunchPhotos attendance={a} />
            </div>
          ))
        )}
        <ListFooter
          shown={list.rows.length}
          total={list.total}
          hasMore={list.hasMore}
          onMore={list.loadMore}
          loading={list.loading}
        />
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewOwnAttendance(customer?.role)) {
    return (
      <CenterState title={t('hrFix.ownerAttendance.deniedTitle')}>
        {t('hrFix.ownerAttendance.deniedBody')}
      </CenterState>
    );
  }
  return <OwnerAttendanceBody />;
}

export default function OwnerAttendancePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
