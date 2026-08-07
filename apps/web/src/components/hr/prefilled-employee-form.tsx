'use client';

import { useSearchParams } from 'next/navigation';

import { HR_MANAGED_ROLES } from '@hydromart/access';

import { EmployeeForm } from '@/components/hr/employee-form';
import { EMPTY_EMPLOYEE_FORM, type EmployeeForm as Form } from '@/lib/hr';

/**
 * C-6: the form's `<select>` offers `HR_MANAGED_ROLES` and nothing else, so a query string
 * carrying `HR`, `FINANCE`, `MARKETING`, `HEAD_OFFICE` or `DIREKTUR` produced a dropdown
 * with no matching option — blank on screen, the unsupported value still in state, `!f.role`
 * passing, and hr-service answering 400. An unrecognised role is dropped rather than cast.
 */
function managedRole(raw: string | null): Form['role'] | null {
  return (HR_MANAGED_ROLES as readonly string[]).includes(raw ?? '')
    ? (raw as Form['role'])
    : null;
}

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
    role: managedRole(params.get('role')) ?? EMPTY_EMPLOYEE_FORM.role,
    depotId: params.get('depotId') ?? EMPTY_EMPLOYEE_FORM.depotId,
  };
  return <EmployeeForm initial={initial} />;
}
