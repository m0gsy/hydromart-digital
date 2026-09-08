'use client';

// Audit F-6 kept this page on the server: it holds no state, no effect and no handler,
// and the query-string prefill lives in its own client island. PR-8 spends that back for
// the two heading strings — `useT` is a client hook, and the alternative was leaving the
// only Indonesian left on the page hardcoded. Everything below still renders in client
// components either way, so what moved is the heading, not the form.
import { Suspense } from 'react';
import { useT } from '@/lib/locale-context';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { EmployeeForm } from '@/components/hr/employee-form';
import { PrefilledEmployeeForm } from '@/components/hr/prefilled-employee-form';
import { SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { EMPTY_EMPLOYEE_FORM } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';

export default function NewEmployeePage() {
  const { t } = useT();
  const { customer } = useAuth();
  // CA-1-30's sibling: the same write form, reached the same way, with the same absent
  // gate. Fixing only the one the row names would leave the identical hole one URL over.
  if (!canManageHr(customer?.role)) {
    return <AccessDeniedHq role={customer?.role} />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('hrFix.employeeNew.title')}
        subtitle={t('hrFix.employeeNew.subtitle')}
      />
      <Suspense fallback={<EmployeeForm initial={EMPTY_EMPLOYEE_FORM} />}>
        <PrefilledEmployeeForm />
      </Suspense>
    </div>
  );
}
