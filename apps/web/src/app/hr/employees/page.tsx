'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { useState } from 'react';

import { Badge, Card, ErrorState, Input, LinkButton, LoadError, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  departmentLabel,
  type Department,
  type Employee,
  type EmployeeStatus,
  type HrPage,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';

const STATUS_TONE: Record<EmployeeStatus, 'success' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  RESIGNED: 'danger',
};

/**
 * Mint the login an employee never got — rows written before "+ Tambah" created accounts,
 * and the rare write that failed between hr-service and auth-service.
 *
 * The server decides: an employee with no jabatan is refused there (there is no role to
 * create the account with), and the refusal is shown here rather than swallowed.
 */
function CreateAccount({ employee, onCreated }: { employee: Employee; onCreated: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.hr.createEmployeeAccount(employee.id), {}, true);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.employees.accountFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-50 disabled:opacity-50"
      >
        Belum punya akun · buatkan
      </button>
      {error && (
        <p className="max-w-[220px] text-right text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function EmployeesPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('');
  const [departmentId, setDepartmentId] = useState('');

  const { data, error, loading, reload } = useAsync<HrPage<Employee>>(
    () =>
      api.get<HrPage<Employee>>(
        endpoints.hr.employees({
          search: search || undefined,
          status: status || undefined,
          departmentId: departmentId || undefined,
          pageSize: 100,
        }),
        true,
      ),
    [search, status, departmentId],
  );
  // K-9: reference data — getCached, like every other department/depot read on main.
  const departments = useAsync<Department[]>(
    () => api.getCached<Department[]>(endpoints.hr.departments(), true),
    [],
  );
  const deptRows = departments.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeader
        title={t('hrFix.employees.title')}
        subtitle={data ? `${data.total} karyawan` : undefined}
        action={
          canManageHr(customer?.role) ? (
            <div className="flex gap-2">
              <LinkButton href="/hr/employees/import" variant="secondary">
                Import Excel
              </LinkButton>
              <LinkButton href="/hr/employees/new">{t('hrFix.employees.add')}</LinkButton>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t('hrFix.employees.searchHint')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}
          className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">{t('hrFix.employees.allStatuses')}</option>
          {(Object.keys(EMPLOYEE_STATUS_LABEL) as EmployeeStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(EMPLOYEE_STATUS_LABEL[s])}
            </option>
          ))}
        </select>
        {departments.error && <LoadError onRetry={departments.reload} />}
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">{t('hrFix.employees.allDepartments')}</option>
          {deptRows.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">{t('hrFix.employees.empty')}</Card>
      )}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 p-4">
              <Link href={`/hr/employees/detail?id=${e.id}`} className="min-w-0 flex-1 hover:opacity-80">
                <p className="truncate font-semibold">{e.fullName}</p>
                <p className="truncate text-xs text-muted">
                  {e.employeeCode} · {e.position} · {t(EMPLOYMENT_STATUS_LABEL[e.employmentStatus])} ·{' '}
                  {/* Without the list, departmentLabel() answers "Belum diatur" for every
                      row at once — a whole roster claiming no department. */}
                  {departments.error ? t('hrFix.employees.departmentUnreadable') : departmentLabel(deptRows, e.departmentId, t)}
                </p>
              </Link>
              {/* The safety net: a row with no login is somebody who cannot clock in, and
                  nothing else on this screen would say so. */}
              {!e.authSubjectId && e.status !== 'RESIGNED' && (
                <CreateAccount employee={e} onCreated={reload} />
              )}
              <Badge tone={STATUS_TONE[e.status]}>{t(EMPLOYEE_STATUS_LABEL[e.status])}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
