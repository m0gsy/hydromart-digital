// Audit F-6: every one of the 226 pages was marked 'use client'. This one holds no
// state, no effect and no handler — it only composes client components, which carry
// their own boundary. Rendering it on the server keeps its own code out of the bundle.
import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';

const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  { key: 'year', required: true, example: String(new Date().getFullYear()), parse: intCell },
  { key: 'quotaDays', required: true, example: '12', parse: intCell },
  // Days already taken this year under the old system. Blank = 0.
  { key: 'usedDays', example: '0', parse: intCell },
];

export default function ImportLeaveBalancesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="hrFix.balancesImport.title"
        description="hrFix.imports.desc.leaveBalances"
        columns={COLUMNS}
        endpoint={endpoints.hr.importLeaveBalances}
        templateName="saldo-cuti"
      />
    </div>
  );
}
