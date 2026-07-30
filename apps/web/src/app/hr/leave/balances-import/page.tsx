'use client';

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
        title="Import Saldo Cuti Awal"
        description="Memindahkan kuota cuti dan cuti yang sudah terpakai dari sistem lama. Tanpa ini, pindah sistem di tengah tahun membuat semua orang seolah punya kuota penuh lagi. Tahun yang sudah punya saldo akan ditimpa."
        columns={COLUMNS}
        endpoint={endpoints.hr.importLeaveBalances}
        templateName="saldo-cuti"
      />
    </div>
  );
}
