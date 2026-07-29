'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  fmtDate,
  leaveDeductsQuota,
  type HrPage,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const TONE: Record<LeaveStatus, 'success' | 'neutral' | 'danger' | 'brand'> = {
  PENDING_MANAGER: 'brand',
  PENDING_HR: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/** Employee self-service: apply for leave and follow it through both approval stages. */
export default function MyLeavePage() {
  const { toast } = useToast();
  const [type, setType] = useState<LeaveType>('ANNUAL');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requests = useAsync<HrPage<LeaveRequest>>(
    () => api.get<HrPage<LeaveRequest>>(endpoints.hr.leaveMe({ pageSize: 50 }), true),
    [],
  );
  const balance = useAsync<LeaveBalance>(
    () => api.get<LeaveBalance>(endpoints.hr.leaveBalanceMe(), true),
    [],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!startDate || !endDate) return setErr('Tanggal mulai dan selesai wajib diisi.');
    if (!reason.trim()) return setErr('Alasan wajib diisi.');
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.submitLeave,
        {
          type,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          reason: reason.trim(),
        },
        true,
      );
      toast('Pengajuan cuti terkirim');
      setReason('');
      requests.reload();
      balance.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Gagal mengirim pengajuan.');
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    try {
      await api.patch(endpoints.hr.cancelLeave(id), {}, true);
      toast('Pengajuan dibatalkan');
      requests.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal membatalkan', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader
        title="Cuti Saya"
        subtitle={
          balance.data
            ? `Kuota ${balance.data.quotaDays} hari · terpakai ${balance.data.usedDays} · sisa ${balance.data.quotaDays - balance.data.usedDays}`
            : 'Ajukan cuti dan pantau persetujuannya'
        }
      />

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Jenis cuti">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeaveType)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABEL[t]}
                  {leaveDeductsQuota(t) ? ' (potong kuota)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mulai">
            <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Selesai">
            <Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Alasan">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Acara keluarga"
            />
          </Field>
          {err && (
            <p className="text-sm font-medium text-red-600" role="alert">
              {err}
            </p>
          )}
          <Button type="submit" loading={saving} className="w-full">
            Ajukan Cuti
          </Button>
          <p className="text-xs text-muted">
            Hari libur nasional dan libur mingguan di dalam rentang tidak memotong kuota.
          </p>
        </form>
      </Card>

      {requests.loading && <Skeleton className="h-24" />}
      {requests.error && <ErrorState message={requests.error} onRetry={requests.reload} />}
      {requests.data && (
        <Card className="divide-y divide-[color:var(--border)]">
          {requests.data.rows.length === 0 && (
            <p className="p-5 text-sm text-muted">Belum ada pengajuan cuti.</p>
          )}
          {requests.data.rows.map((r) => (
            <div key={r.id} className="space-y-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{LEAVE_TYPE_LABEL[r.type]}</span>
                <Badge tone={TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>
              </div>
              <p className="text-sm text-muted">
                {fmtDate(r.startDate)} – {fmtDate(r.endDate)} · {r.workingDays} hari kerja
              </p>
              <p className="text-sm text-muted">{r.reason}</p>
              {r.status === 'REJECTED' && r.decisionNote && (
                <p className="text-sm text-red-600">Alasan penolakan: {r.decisionNote}</p>
              )}
              {(r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HR') && (
                <Button variant="secondary" onClick={() => cancel(r.id)}>
                  Batalkan
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
