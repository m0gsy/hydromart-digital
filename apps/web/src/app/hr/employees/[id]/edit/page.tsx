'use client';

import { use } from 'react';

import { EmployeeForm } from '@/components/hr/employee-form';
import { ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { employeeToForm, type Employee } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

export default function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
