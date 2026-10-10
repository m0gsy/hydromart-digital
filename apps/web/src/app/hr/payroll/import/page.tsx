'use client';

import { CsvImport, intCell, periodCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';


const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  { key: 'periodMonth', required: true, example: '2026-08', text: true, parse: periodCell },
  { key: 'gross', required: true, example: '3000000', parse: intCell },
  { key: 'totalBonus', example: '200000', parse: intCell },
  { key: 'totalDeduction', example: '50000', parse: intCell },
  { key: 'net', example: '3150000', parse: intCell },
  { key: 'presentDays', example: '26', parse: intCell },
];

function Body() {
  return (
    <CsvImport
      title="hrFix.imports.payrollTitle"
      description="hrFix.imports.desc.payroll"
      columns={COLUMNS}
      endpoint={endpoints.hr.importPayrollHistory}
      templateName="riwayat-slip"
    />
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('hrPayroll', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ImportPayrollHistoryPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
