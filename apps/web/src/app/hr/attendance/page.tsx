'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ATTENDANCE_STATUS_LABEL, fmtDate, fmtTime, type Attendance, type AttendanceStatus, type HrPage } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

const TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success', LATE: 'warning', ABSENT: 'danger', LEAVE: 'neutral', HOLIDAY: 'neutral',
};
const STATUSES = Object.keys(ATTENDANCE_STATUS_LABEL) as AttendanceStatus[];

function AttendanceInner() {
  const { customer } = useAuth();
  const { toast } = useToast();
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
    if (!mEmp || !mDate) { toast('Isi employeeId & tanggal', 'error'); return; }
    try {
      await api.post(endpoints.hr.attendanceManual, {
        employeeId: mEmp, workDate: new Date(mDate).toISOString(), status: mStatus, reason: mReason || 'Entri manual',
      }, true);
      toast('Absensi manual disimpan'); setMDate(''); setMReason(''); reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Gagal', 'error'); }
  }

  async function adjust(a: Attendance, status: AttendanceStatus) {
    if (status === a.status) return;
    const reason = window.prompt(`Alasan koreksi ${a.status} → ${status}?`);
    if (!reason) return;
    try {
      await api.patch(endpoints.hr.attendanceAdjust(a.id), { status, reason }, true);
      toast('Dikoreksi'); reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Gagal', 'error'); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title="Absensi" subtitle={data ? `${data.total} catatan` : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Dari<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Sampai<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      {isAdmin && (
        <Card className="flex flex-wrap items-end gap-2 p-4">
          <span className="w-full text-sm font-bold">Entri / koreksi manual</span>
          <label className="text-sm">Employee ID<Input value={mEmp} onChange={(e) => setMEmp(e.target.value)} placeholder="UUID" className="w-56" /></label>
          <label className="text-sm">Tanggal<Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></label>
          <label className="text-sm">Status
            <select value={mStatus} onChange={(e) => setMStatus(e.target.value as AttendanceStatus)} className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-sm">Alasan<Input value={mReason} onChange={(e) => setMReason(e.target.value)} className="w-40" /></label>
          <Button onClick={addManual}>Simpan</Button>
        </Card>
      )}

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
              {isAdmin ? (
                <select
                  value={a.status}
                  onChange={(e) => adjust(a, e.target.value as AttendanceStatus)}
                  aria-label="Koreksi status"
                  className="surface-elevated rounded-lg border border-app px-2 py-1 text-xs"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABEL[s]}</option>)}
                </select>
              ) : (
                <Badge tone={TONE[a.status]}>{ATTENDANCE_STATUS_LABEL[a.status]}</Badge>
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
