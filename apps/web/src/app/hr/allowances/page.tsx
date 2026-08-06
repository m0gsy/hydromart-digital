'use client';

import { useState } from 'react';

import { EmployeeSelect } from '@/components/hr/employee-select';
import { EmployeeAllowances } from '@/components/hr/employee-allowances';
import { Card, ErrorState, LinkButton, SectionHeader, Skeleton } from '@/components/ui';
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title="Tunjangan"
        subtitle="Komponen gaji tetap berulang — terpisah dari bonus di slip gaji"
        action={
          isAdmin ? (
            <div className="flex gap-2">
              <LinkButton href="/hr/allowances/import" variant="secondary">
                Import Excel
              </LinkButton>
              <LinkButton href="/hr/loans/import" variant="secondary">
                Import Kasbon
              </LinkButton>
            </div>
          ) : undefined
        }
      />

      {/* G-1: this dropdown is the component the five UUID fields now use — the copy that
          lived here is gone, and its loading and error states moved with it. */}
      <Card className="p-5">
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} />
      </Card>

      {employeeId && <EmployeeAllowances employeeId={employeeId} isAdmin={isAdmin} />}
    </div>
  );
}
