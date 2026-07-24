'use client';

import Link from 'next/link';
import { use, useState } from 'react';

import { FaceCapture } from '@/components/hr/face-capture';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, LinkButton, Money, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  fmtDate,
  type Employee,
  type EmploymentHistory,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { customer } = useAuth();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);

  const emp = useAsync<Employee>(() => api.get<Employee>(endpoints.hr.employee(id), true), [id]);
  const history = useAsync<EmploymentHistory[]>(() => api.get<EmploymentHistory[]>(endpoints.hr.employeeHistory(id), true), [id]);

  const [frames, setFrames] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  async function enroll() {
    setEnrolling(true);
    try {
      await api.post(endpoints.hr.enrollFace(id), { images: frames }, true);
      toast('Wajah berhasil di-enroll');
      setFrames([]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal enroll wajah', 'error');
    } finally {
      setEnrolling(false);
    }
  }

  if (emp.loading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (emp.error) return <div className="mx-auto max-w-3xl"><ErrorState message={emp.error} onRetry={emp.reload} /></div>;
  const e = emp.data!;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={e.fullName}
        subtitle={`${e.employeeCode} · ${e.position}`}
        action={isAdmin ? <LinkButton href={`/hr/employees/${id}/edit`} variant="secondary">Edit</LinkButton> : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={e.status === 'ACTIVE' ? 'success' : e.status === 'RESIGNED' ? 'danger' : 'neutral'}>{EMPLOYEE_STATUS_LABEL[e.status]}</Badge>
        <Badge tone="brand">{EMPLOYMENT_STATUS_LABEL[e.employmentStatus]}</Badge>
      </div>

      <Card className="divide-y divide-[color:var(--border)] p-5">
        <Row label="No. HP" value={e.phone} />
        <Row label="Email" value={e.email ?? '—'} />
        <Row label="Tanggal masuk" value={fmtDate(e.joinDate)} />
        <Row label="Tipe gaji" value={e.salaryType === 'DAILY' ? 'Harian' : 'Bulanan'} />
        <Row label="Nominal gaji" value={<Money amount={Number(e.salaryType === 'DAILY' ? e.dailyRate : e.monthlyRate) || 0} />} />
        <Row label="Bank" value={e.bankName ? `${e.bankName} · ${e.bankAccount ?? ''}` : '—'} />
        <Row label="Kontak darurat" value={e.emergencyName ? `${e.emergencyName} · ${e.emergencyPhone ?? ''}` : '—'} />
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link href={`/hr/payroll?employeeId=${id}`} className="text-sm font-semibold text-brand-700 hover:underline">Lihat Payroll →</Link>
        <Link href={`/hr/attendance?employeeId=${id}`} className="text-sm font-semibold text-brand-700 hover:underline">Riwayat Absensi →</Link>
        <Link href={`/hr/performance?employeeId=${id}`} className="text-sm font-semibold text-brand-700 hover:underline">Kinerja →</Link>
      </div>

      {isAdmin && (
        <Card className="space-y-3 p-5">
          <h3 className="font-bold">Enroll Wajah</h3>
          <p className="text-xs text-muted">Ambil 1–3 foto wajah yang jelas untuk verifikasi absensi.</p>
          <FaceCapture onCapture={(f) => setFrames((prev) => [...prev, f].slice(0, 3))} disabled={frames.length >= 3} />
          {frames.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm">{frames.length} foto siap</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setFrames([])}>Reset</Button>
                <Button onClick={enroll} loading={enrolling}>Simpan Enroll</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 font-bold">Riwayat Kepegawaian</h3>
        {history.loading && <Skeleton className="h-20" />}
        {history.data && history.data.length === 0 && <p className="text-sm text-muted">Belum ada riwayat.</p>}
        {history.data && history.data.length > 0 && (
          <ul className="space-y-2">
            {history.data.map((h) => (
              <li key={h.id} className="flex justify-between gap-3 border-l-2 border-brand-200 pl-3 text-sm">
                <span>
                  <b>{h.changeType}</b>
                  {h.fromValue?.value != null && <> · {h.fromValue.value} → {h.toValue?.value}</>}
                </span>
                <span className="whitespace-nowrap text-muted">{fmtDate(h.effectiveDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
