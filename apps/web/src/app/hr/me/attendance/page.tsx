'use client';

import {
  Badge,
  Card,
  CenterState,
  ErrorState,
  ListFooter,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  ATTENDANCE_STATUS_LABEL,
  fmtDate,
  fmtTime,
  type Attendance,
  type AttendanceStatus,
  type HrPage,
} from '@/lib/hr';
import { usePagedList } from '@/lib/use-paged-list';

/**
 * CA-1-19. 60 rows is roughly two months of shifts, and this screen is where an employee
 * checks a day they think was recorded wrong — which is usually a day on a payslip they
 * have only just been paid for, and often further back than two months. There was no page
 * 2 and nothing said there was a page 1: the history simply ended, mid-career.
 */
const PAGE_SIZE = 60;

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
  LEAVE: 'neutral',
  HOLIDAY: 'neutral',
  PENDING: 'warning',
};

export default function MyAttendancePage() {
  const { t } = useT();
  const list = usePagedList<Attendance>(
    (page) =>
      api
        .get<HrPage<Attendance>>(endpoints.hr.attendanceMe({ page, pageSize: PAGE_SIZE }), true)
        .then((p) => ({ items: p.rows, total: p.total })),
    [],
  );

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title="Absensi Saya" />
      {list.loading && list.rows.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && list.rows.length === 0 && (
        <CenterState title={t('hrFix.myAttendance.empty')}>
          {t('hrFix.myAttendance.emptyBody')}
        </CenterState>
      )}
      {list.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {list.rows.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span className="font-medium">{fmtDate(a.workDate)}</span>
              <span className="text-muted">
                {fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}
              </span>
              <Badge tone={TONE[a.status]}>{t(ATTENDANCE_STATUS_LABEL[a.status])}</Badge>
            </div>
          ))}
        </Card>
      )}
      <ListFooter
        shown={list.rows.length}
        total={list.total}
        hasMore={list.hasMore}
        onMore={list.loadMore}
        loading={list.loading}
      />
    </div>
  );
}
