'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { useState } from 'react';

import { FaceCapture } from '@/components/hr/face-capture';
import { EmployeeAllowances } from '@/components/hr/employee-allowances';
import { EmployeeAssets } from '@/components/hr/employee-assets';
import { EmployeeDocuments } from '@/components/hr/employee-documents';
import { EmployeeLoans } from '@/components/hr/employee-loans';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, LinkButton, LoadError, Money, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  GENDER_LABEL,
  PTKP_STATUS_LABEL,
  departmentLabel,
  fmtDate,
  tenureLabel,
  type Department,
  type Employee,
  type EmploymentHistory,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { t } = useT();
  const id = useQueryParam('id');
  const { customer } = useAuth();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);

  const emp = useAsync<Employee>(() => api.get<Employee>(endpoints.hr.employee(id), true), [id]);
  const history = useAsync<EmploymentHistory[]>(
    () => api.get<EmploymentHistory[]>(endpoints.hr.employeeHistory(id), true),
    [id],
  );
  const departments = useAsync<Department[]>(
    () => api.get<Department[]>(endpoints.hr.departments(), true),
    [],
  );

  const [frames, setFrames] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  async function enroll() {
    setEnrolling(true);
    try {
      await api.post(endpoints.hr.enrollFace(id), { images: frames }, true);
      toast(t('hrFix.employeeDetailExtra.faceEnrolled'));
      setFrames([]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.employeeDetailExtra.faceFailed'), 'error');
    } finally {
      setEnrolling(false);
    }
  }

  if (emp.loading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (emp.error)
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={emp.error} onRetry={emp.reload} />
      </div>
    );
  const e = emp.data!;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={e.fullName}
        subtitle={`${e.employeeCode} · ${e.position}`}
        action={
          isAdmin ? (
            <LinkButton href={`/hr/employees/detail/edit?id=${id}`} variant="secondary">
              Edit
            </LinkButton>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge
          tone={e.status === 'ACTIVE' ? 'success' : e.status === 'RESIGNED' ? 'danger' : 'neutral'}
        >
          {t(EMPLOYEE_STATUS_LABEL[e.status])}
        </Badge>
        <Badge tone="brand">{t(EMPLOYMENT_STATUS_LABEL[e.employmentStatus])}</Badge>
      </div>

      <Card className="divide-y divide-[color:var(--border)] p-5">
        <Row label={t('hrFix.employeeDetail.phone')} value={e.phone} />
        <Row label={t('hrFix.employeeDetail.email')} value={e.email ?? '—'} />
        {/* departmentLabel() answers "Belum diatur" for an id it cannot resolve, so an
            unread list tells you this person has no department when they do. */}
        <Row
          label={t('hrFix.employeeDetail.department')}
          value={
            departments.error
              ? t('hrFix.employeeDetailExtra.unreadable')
              : departmentLabel(departments.data ?? [], e.departmentId, t)
          }
        />
        <Row label={t('hrFix.employeeDetail.joinDate')} value={fmtDate(e.joinDate)} />
        <Row label={t('hrFix.employeeDetail.tenure')} value={tenureLabel(e.joinDate, t)} />
        <Row label={t('hrFix.employeeDetail.salaryType')} value={e.salaryType === 'DAILY' ? 'Harian' : 'Bulanan'} />
        <Row
          label={t('hrFix.employeeDetail.salaryAmount')}
          value={
            <Money amount={Number(e.salaryType === 'DAILY' ? e.dailyRate : e.monthlyRate) || 0} />
          }
        />
        <Row label={t('hrFix.employeeDetail.bank')} value={e.bankName ? `${e.bankName} · ${e.bankAccount ?? ''}` : '—'} />
        <Row
          label={t('hrFix.employeeDetail.emergency')}
          value={e.emergencyName ? `${e.emergencyName} · ${e.emergencyPhone ?? ''}` : '—'}
        />
        <Row label="NPWP" value={e.npwp ?? '—'} />
        <Row label={t('hrFix.employeeDetail.bpjsKes')} value={e.bpjsKes ?? '—'} />
        <Row label={t('hrFix.employeeDetail.bpjsTk')} value={e.bpjsTk ?? '—'} />
        <Row label={t('hrFix.employeeDetail.nik')} value={e.nik ?? '—'} />
        <Row label={t('hrFix.employeeDetail.birthDate')} value={e.birthDate ? fmtDate(e.birthDate) : '—'} />
        <Row label={t('hrFix.employeeDetail.gender')} value={e.gender ? t(GENDER_LABEL[e.gender]) : '—'} />
        <Row label={t('hrFix.employeeDetail.address')} value={e.address ?? '—'} />
        <Row label={t('hrFix.employeeDetail.ptkp')} value={e.ptkpStatus ? t(PTKP_STATUS_LABEL[e.ptkpStatus]) : '—'} />
        <Row label={t('hrFix.employeeDetail.contractEnd')} value={e.contractEndDate ? fmtDate(e.contractEndDate) : '—'} />
      </Card>

      <EmployeeAllowances employeeId={id} />
      <EmployeeDocuments employeeId={id} isAdmin={isAdmin} />
      <EmployeeAssets employeeId={id} />

      <EmployeeLoans employeeId={id} isAdmin={isAdmin} />

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/hr/payroll?employeeId=${id}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          {t('hrFix.employeeDetail.viewPayroll')}
        </Link>
        <Link
          href={`/hr/attendance?employeeId=${id}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          {t('hrFix.employeeDetail.viewAttendance')}
        </Link>
        <Link
          href={`/hr/performance?employeeId=${id}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Kinerja →
        </Link>
      </div>

      {isAdmin && (
        <Card className="space-y-3 p-5">
          <h3 className="font-bold">{t('hrFix.employeeDetail.enrollFace')}</h3>
          <p className="text-xs text-muted">
            {t('hrFix.employeeDetail.enrolHint')}
          </p>
          <FaceCapture
            onCapture={(f) => setFrames((prev) => [...prev, f].slice(0, 3))}
            disabled={frames.length >= 3}
          />
          {frames.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm">{frames.length} foto siap</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setFrames([])}>
                  Reset
                </Button>
                <Button onClick={enroll} loading={enrolling}>
                  {t('hrFix.employeeDetail.saveEnrol')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 font-bold">{t('hrFix.employeeDetail.history')}</h3>
        {history.loading && <Skeleton className="h-20" />}
        {history.error && <LoadError onRetry={history.reload} />}
        {history.data && history.data.length === 0 && (
          <p className="text-sm text-muted">{t('hrFix.employeeDetail.noHistory')}</p>
        )}
        {history.data && history.data.length > 0 && (
          <ul className="space-y-2">
            {history.data.map((h) => (
              <li
                key={h.id}
                className="flex justify-between gap-3 border-l-2 border-brand-200 pl-3 text-sm"
              >
                <span>
                  <b>{h.changeType}</b>
                  {h.fromValue?.value != null && (
                    <>
                      {' '}
                      · {h.fromValue.value} → {h.toValue?.value}
                    </>
                  )}
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
