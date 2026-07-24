'use client';

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
