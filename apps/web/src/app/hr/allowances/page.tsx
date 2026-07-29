'use client';

import { useState } from 'react';

import { EmployeeAllowances } from '@/components/hr/employee-allowances';
import { Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { type Employee, type HrPage } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

/** Allowances are per employee, so this page is a picker plus the same panel the detail page shows. */
export default function AllowancesPage() {
  const { customer } = useAuth();
  const isAdmin = canManageHr(customer?.role);
  const [employeeId, setEmployeeId] = useState('');

  const employees = useAsync<HrPage<Employee>>(
    () =>
      api.get<HrPage<Employee>>(endpoints.hr.employees({ status: 'ACTIVE', pageSize: 200 }), true),
    [],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title="Tunjangan"
        subtitle="Komponen gaji tetap berulang — terpisah dari bonus di slip gaji"
      />

      {employees.loading && <Skeleton className="h-12" />}
      {employees.error && <ErrorState message={employees.error} onRetry={employees.reload} />}
      {employees.data && (
        <Card className="p-5">
          <label className="text-sm">
            Karyawan
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="surface-elevated mt-1 block w-full rounded-lg border border-app px-3.5 py-2.5 text-sm"
            >
              <option value="">Pilih karyawan…</option>
              {employees.data.rows.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} — {e.fullName}
                </option>
              ))}
            </select>
          </label>
        </Card>
      )}

      {employeeId && <EmployeeAllowances employeeId={employeeId} isAdmin={isAdmin} />}
    </div>
  );
}
