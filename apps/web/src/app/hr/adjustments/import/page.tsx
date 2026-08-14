// Audit F-6: every one of the 226 pages was marked 'use client'. This one holds no
// state, no effect and no handler — it only composes client components, which carry
// their own boundary. Rendering it on the server keeps its own code out of the bundle.
import { CsvImport, intCell, periodCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';

const DEDUCTION_TYPES = ['LATE', 'ABSENCE', 'MANUAL', 'CASH_ADVANCE', 'OTHER'] as const;

const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  { key: 'type', required: true, example: 'MANUAL', options: DEDUCTION_TYPES },
  { key: 'amount', required: true, example: '50000', parse: intCell },
  { key: 'periodMonth', required: true, example: '2026-07', text: true, parse: periodCell },
  { key: 'note', example: '' },
];

export default function ImportDeductionsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="hrFix.imports.deductions"
        description="Unggah potongan gaji untuk satu periode. Setiap baris ditambahkan apa adanya — dua potongan MANUAL bernilai sama dalam satu bulan memang bisa sah, jadi tidak ada yang digabung otomatis."
        columns={COLUMNS}
        endpoint={endpoints.hr.importDeductions}
        templateName="potongan"
      />
    </div>
  );
}
