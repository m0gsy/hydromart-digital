// Audit F-6: every one of the 226 pages was marked 'use client'. This one holds no
// state, no effect and no handler — it only composes client components, which carry
// their own boundary. Rendering it on the server keeps its own code out of the bundle.
import { EmployeeForm } from '@/components/hr/employee-form';
import { SectionHeader } from '@/components/ui';
import { EMPTY_EMPLOYEE_FORM } from '@/lib/hr';

export default function NewEmployeePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Tambah Karyawan" subtitle="Kode HR-#### dibuat otomatis" />
      <EmployeeForm initial={EMPTY_EMPLOYEE_FORM} />
    </div>
  );
}
