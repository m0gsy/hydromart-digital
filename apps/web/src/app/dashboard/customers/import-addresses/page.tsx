'use client';

import { CsvImport, phoneCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
  { key: 'label', example: 'Kios' },
  { key: 'recipientName', required: true, example: 'Siti Aminah' },
  { key: 'addressLine', required: true, example: 'Jl. Melati 3 No. 7 RT 04' },
  { key: 'city', required: true, example: 'Bekasi' },
  { key: 'province', example: 'Jawa Barat' },
  { key: 'postalCode', example: '17111', text: true },
  { key: 'landmark', example: 'pagar hijau sebelah warung Bu Ani' },
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
      title="hrFix.imports.addressesTitle"
      description="hrFix.imports.desc.addresses"
      columns={COLUMNS}
      endpoint={endpoints.depotCrm.importAddresses}
      templateName="alamat-pelanggan"
      body={{ depotId: selectedId }}
    />
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotCrmWrite', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ImportCustomerAddressesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
