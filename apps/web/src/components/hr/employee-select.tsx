'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ErrorState, Skeleton } from '@/components/ui';
import { useAsync } from '@/lib/use-async';
import type { Employee, HrPage } from '@/lib/hr';

/**
 * Pick an employee by name. §G-1.
 *
 * Five HR screens asked a human to paste a UUID — `placeholder="UUID"`, literally — while
 * this exact `employeeCode — fullName` dropdown already existed, copy-pasted four times a
 * few files away. One component, five wired fields, four copies deleted.
 *
 * `getCached`, because the active-employee list is reference data and several of these
 * screens sit side by side in one session.
 *
 * Deliberately renders its own loading and error states rather than returning null: an
 * empty box where a picker should be is how somebody concludes the feature is broken.
 */
export function EmployeeSelect({
  value,
  onChange,
  label = 'Karyawan',
  placeholder = 'Pilih karyawan…',
  className = '',
  disabled = false,
}: {
  value: string;
  onChange: (employeeId: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const employees = useAsync<HrPage<Employee>>(
    () =>
      api.getCached<HrPage<Employee>>(
        // ponytail: 100 is the DTO's hard @Max — a depot past 100 active staff needs a
        // search-as-you-type picker, not a bigger page.
        endpoints.hr.employees({ status: 'ACTIVE', pageSize: 100 }),
        true,
      ),
    [],
  );

  if (employees.loading) return <Skeleton className="h-12 w-56" />;
  if (employees.error) {
    return <ErrorState message={employees.error} onRetry={employees.reload} />;
  }

  return (
    <label className={`text-sm ${className}`}>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="surface-elevated mt-1 block w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
      >
        <option value="">{placeholder}</option>
        {(employees.data?.rows ?? []).map((e) => (
          <option key={e.id} value={e.id}>
            {e.employeeCode} — {e.fullName}
          </option>
        ))}
      </select>
    </label>
  );
}
