'use client';

import { CsvImport, intCell, phoneCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'customerPhone', required: true, example: '081234567890', text: true, parse: phoneCell },
  { key: 'customerName', example: 'Siti Aminah' },
  { key: 'quantity', required: true, example: '3', parse: intCell },
  { key: 'depositHeld', example: '60000', parse: intCell },
];

function Body() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId: an import writes into exactly one depot, and scopedId falls back
  // to the first depot when the switcher says "Semua depot".
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.imports.gallonBalancesTitle"
      description="hrFix.imports.desc.gallonBalances"
      columns={COLUMNS}
      endpoint={endpoints.gallonIssues.import(selectedId)}
      templateName="saldo-galon"
    />
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('returnsWrite', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ImportGallonBalancesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
