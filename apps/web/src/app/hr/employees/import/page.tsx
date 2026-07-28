'use client';

import { useMemo } from 'react';

import { CsvImport, intCell, phoneCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const STAFF_ROLES = [
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'DRIVER',
  'FINANCE',
  'HR',
  'MARKETING',
] as const;

export default function ImportEmployeesPage() {
  const { depots } = useDepot();

  // `depotCode` in, `depotId` out: nobody should be typing a UUID into a spreadsheet.
  // The console already holds the depot list, so the lookup costs no round-trip — and
  // the server still checks the resolved id against the caller's depot scope.
  const columns = useMemo<ImportColumn[]>(
    () => [
      { key: 'fullName', required: true, example: 'Budi Santoso' },
      { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
      {
        key: 'depotCode',
        field: 'depotId',
        required: true,
        example: depots[0]?.code ?? 'JKT-01',
        text: true,
        options: depots.map((d) => d.code),
        parse: (raw) => {
          const match = depots.find((d) => d.code.toUpperCase() === raw.toUpperCase());
          if (!match) throw new Error(`kode depot "${raw}" tidak dikenal`);
          return match.id;
        },
      },
      { key: 'position', required: true, example: 'Kurir' },
      // The login role provisioned for this person. auth-service rejects anything
      // outside STAFF_IMPORT_ROLES, so a spreadsheet can never mint an office account.
      { key: 'role', required: true, example: 'DRIVER', options: STAFF_ROLES },
      {
        key: 'employmentStatus',
        required: true,
        example: 'PROBATION',
        options: ['PROBATION', 'CONTRACT', 'PERMANENT'],
      },
      { key: 'joinDate', required: true, example: '2026-01-01' },
      { key: 'salaryType', required: true, example: 'DAILY', options: ['DAILY', 'MONTHLY'] },
      { key: 'dailyRate', example: '150000', parse: intCell },
      { key: 'monthlyRate', example: '', parse: intCell },
      { key: 'email', example: '' },
      { key: 'bankName', example: '' },
      { key: 'bankAccount', example: '' },
    ],
    [depots],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="Import Karyawan"
        description="Unggah Excel atau CSV untuk menambah banyak karyawan sekaligus. Setiap baris juga dibuatkan akun login (OTP) sesuai kolom role, dan langsung tertaut ke depot yang ditulis."
        columns={columns}
        endpoint={endpoints.hr.importEmployees}
        templateName="karyawan"
      />
    </div>
  );
}
