'use client';

import { CsvImport, dateCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';


const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  { key: 'shiftName', required: true, example: 'Pagi' },
  { key: 'effectiveFrom', required: true, example: '2026-03-01', text: true, parse: dateCell },
  { key: 'note', example: '' },
];

function Body() {
  return (
    <CsvImport
      title="hrFix.imports.shiftsTitle"
      description="hrFix.imports.desc.shifts"
      columns={COLUMNS}
      endpoint={endpoints.hr.importShiftAssignments}
      templateName="riwayat-shift"
    />
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('hrAdmin', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ImportShiftHistoryPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
