'use client';

import { CsvImport, intCell, phoneCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Toko Berkah' },
  { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
  { key: 'discountPct', required: true, example: '5', parse: intCell },
  { key: 'monthlyTargetQty', required: true, example: '100', parse: intCell },
  { key: 'joinDate', required: true, example: '2026-01-01' },
  { key: 'note', example: '' },
];

export default function ImportResellersPage() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — see the note in the pelanggan import: "Semua depot" would
  // silently resolve to depots[0] and file every reseller under the wrong depot.
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.imports.resellers"
      description="Nomor yang belum punya akun akan didaftarkan lebih dulu, lalu terdaftar sebagai reseller depot ini dengan persen diskonnya."
      columns={COLUMNS}
      endpoint={endpoints.resellers.import}
      templateName="reseller"
      body={{ depotId: selectedId }}
    />
  );
}
