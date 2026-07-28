'use client';

import { CsvImport, enumCell, intCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';

// Column keys ARE the JSON keys the API validates, so the CSV header is the contract.
// `role` is the login role provisioned for the row — auth-service rejects anything
// outside STAFF_IMPORT_ROLES, so a spreadsheet can never mint an office account.
const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Budi Santoso' },
  { key: 'phone', required: true, example: '081234567890' },
  { key: 'depotId', required: true, example: '11111111-1111-4111-8111-111111111111' },
  { key: 'position', required: true, example: 'Kurir' },
  {
    key: 'role',
    required: true,
    example: 'DRIVER',
    parse: enumCell(['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'DRIVER', 'FINANCE', 'HR', 'MARKETING']),
  },
  {
    key: 'employmentStatus',
    required: true,
    example: 'PROBATION',
    parse: enumCell(['PROBATION', 'CONTRACT', 'PERMANENT']),
  },
  { key: 'joinDate', required: true, example: '2026-01-01' },
  {
    key: 'salaryType',
    required: true,
    example: 'DAILY',
    parse: enumCell(['DAILY', 'MONTHLY']),
  },
  { key: 'dailyRate', example: '150000', parse: intCell },
  { key: 'monthlyRate', example: '', parse: intCell },
  { key: 'email', example: '' },
  { key: 'bankName', example: '' },
  { key: 'bankAccount', example: '' },
];

export default function ImportEmployeesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="Import Karyawan"
        description="Unggah CSV untuk menambah banyak karyawan sekaligus. Setiap baris juga dibuatkan akun login (OTP) sesuai kolom role, dan langsung tertaut ke depot yang ditulis."
        columns={COLUMNS}
        endpoint={endpoints.hr.importEmployees}
        templateName="karyawan.csv"
      />
    </div>
  );
}
