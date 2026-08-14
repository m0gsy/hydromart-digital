// Audit F-6: every one of the 226 pages was marked 'use client'. This one holds no
// state, no effect and no handler — it only composes client components, which carry
// their own boundary. Rendering it on the server keeps its own code out of the bundle.
import { CsvImport, dateCell, intCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';

const ALLOWANCE_TYPES = ['TRANSPORT', 'MEAL', 'POSITION', 'HOUSING', 'OTHER'] as const;

// Keyed by staff code: the person filling this in reads HR-0007 off the employee list, and
// the server resolves it against their own depot scope.
const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  { key: 'type', required: true, example: 'TRANSPORT', options: ALLOWANCE_TYPES },
  { key: 'amount', required: true, example: '300000', parse: intCell },
  { key: 'effectiveFrom', required: true, example: '2026-01-01', text: true, parse: dateCell },
  // Blank = open-ended, which is what a standing transport allowance is.
  { key: 'effectiveTo', example: '', text: true, parse: dateCell },
  { key: 'note', example: '' },
];

export default function ImportAllowancesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="hrFix.imports.allowances"
        description="Unggah tunjangan tetap (transport, makan, jabatan) untuk banyak karyawan sekaligus. Setiap baris ditambahkan — mengunggah file yang sama dua kali menghasilkan tunjangan ganda."
        columns={COLUMNS}
        endpoint={endpoints.hr.importAllowances}
        templateName="tunjangan"
      />
    </div>
  );
}
