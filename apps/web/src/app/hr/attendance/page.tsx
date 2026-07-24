'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Badge, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ATTENDANCE_STATUS_LABEL, fmtDate, fmtTime, type Attendance, type AttendanceStatus, type HrPage } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success', LATE: 'warning', ABSENT: 'danger', LEAVE: 'neutral', HOLIDAY: 'neutral',
};

function AttendanceInner() {
  const employeeId = useSearchParams().get('employeeId') ?? undefined;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, error, loading, reload } = useAsync<HrPage<Attendance>>(
    () => api.get<HrPage<Attendance>>(endpoints.hr.attendance({ employeeId, from: from || undefined, to: to || undefined, pageSize: 100 }), true),
    [employeeId, from, to],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title="Absensi" subtitle={data ? `${data.total} catatan` : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Dari<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Sampai<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      {loading && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">Tidak ada catatan absensi.</Card>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="font-medium">{fmtDate(a.workDate)}</span>
              <span className="text-muted">{fmtTime(a.checkInAt)} – {fmtTime(a.checkOutAt)}</span>
              <span className="tabular-nums text-muted">{a.lateMinutes > 0 ? `+${a.lateMinutes}m` : '—'}</span>
              <Badge tone={TONE[a.status]}>{ATTENDANCE_STATUS_LABEL[a.status]}</Badge>
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
