'use client';

import { useSearchParams } from 'next/navigation';

import { EmployeeForm } from '@/components/hr/employee-form';
import { EMPTY_EMPLOYEE_FORM, type EmployeeForm as Form } from '@/lib/hr';

/**
 * Prefill from the query string, used by the reconciliation badge on `/hq/staff`: an
 * account with no employee record links here carrying what that page knows.
 *
 * Deliberately only identity fields. Salary and join date are never guessed — an invented
 * salary is worse than an empty box somebody has to fill in.
 *
 * Its own file so the page above it can stay a server component (audit F-6): `useSearchParams`
 * is the only thing on that route that needs the browser.
 */
export function PrefilledEmployeeForm() {
  const params = useSearchParams();
  const initial: Form = {
    ...EMPTY_EMPLOYEE_FORM,
    fullName: params.get('fullName') ?? EMPTY_EMPLOYEE_FORM.fullName,
    phone: params.get('phone') ?? EMPTY_EMPLOYEE_FORM.phone,
    role: (params.get('role') as Form['role']) ?? EMPTY_EMPLOYEE_FORM.role,
    depotId: params.get('depotId') ?? EMPTY_EMPLOYEE_FORM.depotId,
  };
  return <EmployeeForm initial={initial} />;
}
