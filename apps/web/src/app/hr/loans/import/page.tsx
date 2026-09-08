// Audit F-6: every one of the 226 pages was marked 'use client'. This one holds no
// state, no effect and no handler — it only composes client components, which carry
// their own boundary. Rendering it on the server keeps its own code out of the bundle.
import { CsvImport, intCell, periodCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';

const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  // Balance still owed, NOT the original loan — the payroll engine counts forward from here.
  { key: 'principal', required: true, example: '1500000', parse: intCell },
  { key: 'installmentAmount', required: true, example: '250000', parse: intCell },
  { key: 'startPeriod', required: true, example: '2026-08', text: true, parse: periodCell },
  { key: 'note', example: '' },
];

export default function ImportLoansPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="hrFix.imports.loansTitle"
        description="hrFix.imports.desc.loans"
        columns={COLUMNS}
        endpoint={endpoints.hr.importLoans}
        templateName="kasbon"
      />
    </div>
  );
}
