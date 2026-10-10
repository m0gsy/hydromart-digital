'use client';

import { CsvImport, dateCell, intCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';


const COLUMNS: ImportColumn[] = [
  { key: 'employeeCode', required: true, example: 'HR-0001', text: true },
  { key: 'workDate', required: true, example: '2026-09-01', text: true, parse: dateCell },
  { key: 'status', required: true, example: 'PRESENT', options: ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'] },
  { key: 'lateMinutes', example: '0', parse: intCell },
];

function Body() {
  return (
    <CsvImport
      title="hrFix.imports.attendanceTitle"
      description="hrFix.imports.desc.attendance"
      columns={COLUMNS}
      endpoint={endpoints.hr.importAttendanceHistory}
      templateName="riwayat-absensi"
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

export default function ImportAttendanceHistoryPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
