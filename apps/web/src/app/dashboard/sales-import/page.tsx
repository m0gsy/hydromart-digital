'use client';

import { CsvImport, dateCell, intCell, numberCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'externalRef', required: true, example: 'INV-00123', text: true },
  { key: 'occurredAt', required: true, example: '2025-03-14', parse: dateCell },
  { key: 'customerLabel', example: 'Budi Santoso' },
  { key: 'productLabel', required: true, example: 'SKU-19L-001' },
  { key: 'quantity', required: true, example: '2', parse: intCell },
  { key: 'unitPrice', required: true, example: '20000', parse: numberCell },
  { key: 'lineTotal', required: true, example: '40000', parse: numberCell },
  { key: 'paymentMethod', example: 'Tunai' },
];

function ImportSalesBody() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — "Semua depot" would silently file every row under depots[0].
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.imports.salesHistory"
      description={t('hrFix.imports.salesHistoryBody')}
      columns={COLUMNS}
      endpoint={endpoints.salesImport.import}
      templateName="riwayat-transaksi"
      body={{ depotId: selectedId }}
    />
  );
}

/** Same capability gate shape as the reseller import wizard — hiding the link is a
 *  courtesy; `salesImportAdmin` is what the server actually turns on. */
function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('salesImportAdmin', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <ImportSalesBody />;
}

export default function ImportSalesTransactionsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
