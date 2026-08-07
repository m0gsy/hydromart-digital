'use client';

import { EmployeeForm } from '@/components/hr/employee-form';
import { ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { employeeToForm, type Employee } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

export default function EditEmployeePage() {
  const id = useQueryParam('id');
  const { data, error, loading, reload } = useAsync<Employee>(() => api.get<Employee>(endpoints.hr.employee(id), true), [id]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Edit Karyawan" subtitle={data?.employeeCode} />
      {loading && <Skeleton className="h-96" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && <EmployeeForm id={id} initial={employeeToForm(data)} />}
    </div>
  );
}
