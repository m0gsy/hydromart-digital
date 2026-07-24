'use client';

import { Badge, Card, CenterState, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ATTENDANCE_STATUS_LABEL, fmtDate, fmtTime, type Attendance, type AttendanceStatus, type HrPage } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success', LATE: 'warning', ABSENT: 'danger', LEAVE: 'neutral', HOLIDAY: 'neutral',
};

export default function MyAttendancePage() {
  const { data, error, loading, reload } = useAsync<HrPage<Attendance>>(
    () => api.get<HrPage<Attendance>>(endpoints.hr.attendanceMe({ pageSize: 60 }), true),
    [],
  );

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title="Absensi Saya" />
      {loading && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <CenterState title="Belum ada absensi">Absensi kamu akan muncul di sini.</CenterState>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span className="font-medium">{fmtDate(a.workDate)}</span>
              <span className="text-muted">{fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}</span>
              <Badge tone={TONE[a.status]}>{ATTENDANCE_STATUS_LABEL[a.status]}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
