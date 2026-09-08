'use client';

import { AccessDeniedHq } from '@/components/hq/access-denied';
import { EmployeeForm } from '@/components/hr/employee-form';
import { useT } from '@/lib/locale-context';
import { ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { employeeToForm, type Employee } from '@/lib/hr';
import { useAuth } from '@/lib/auth-context';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

export default function EditEmployeePage() {
  const { t } = useT();
  const { customer } = useAuth();
  const id = useQueryParam('id');
  const mayEdit = canManageHr(customer?.role);
  const { data, error, loading, reload } = useAsync<Employee>(
    // Not even asked for when the reader may not edit it: a denied role should not put a
    // 403 in the logs on its way to a screen that was never going to open.
    () => (mayEdit ? api.get<Employee>(endpoints.hr.employee(id), true) : Promise.resolve(null as unknown as Employee)),
    [id, mayEdit],
  );

  /*
   * CA-1-30 — the URL was the gate.
   *
   * The employees LIST hides its "Ubah" control from anyone without `hrManage`, and this
   * page had no gate of its own — so a role that may only read the roster reached a full
   * write form by typing the address, filled it in, and learnt it was refused at Simpan.
   * hr-service does refuse the PATCH, so nothing was ever written; what was wrong is that
   * the screen invited the work and then threw it away.
   *
   * Same denial component the HR layout already uses for the console-level gate, so the
   * two read as one rule rather than two.
   */
  if (!mayEdit) {
    return <AccessDeniedHq role={customer?.role} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title={t('hrFix.employeeEdit.title')} subtitle={data?.employeeCode} />
      {loading && <Skeleton className="h-96" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && <EmployeeForm id={id} initial={employeeToForm(data)} />}
    </div>
  );
}
