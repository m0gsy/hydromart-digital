'use client';

import { CsvImport, intCell, numberCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  {
    key: 'productId',
    required: true,
    example: '11111111-1111-4111-8111-111111111111',
    text: true,
  },
  // i18n-ok: sample cell values below are what the uploaded file must literally contain.
  { key: 'productName', required: true, example: 'Galon 19L' },
  { key: 'currentPrice', required: true, example: '20000', parse: intCell },
  { key: 'adjustType', required: true, example: 'PERCENT', options: ['PERCENT', 'FIXED'] },
  { key: 'value', required: true, example: '-10', parse: numberCell },
  { key: 'note', example: 'Menyesuaikan harga pesaing' }, // i18n-ok: sample cell value
];

export default function ImportPricesPage() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — see the note in the pelanggan import: "Semua depot" would
  // silently resolve to depots[0] and propose price overrides for the wrong depot.
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.importsPricing.title"
      description="Setiap baris menjadi usulan override harga dan tetap menunggu persetujuan HQ — tidak langsung berlaku."
      columns={COLUMNS}
      endpoint={endpoints.priceOverrides.import(selectedId)}
      templateName="harga-depot"
    />
  );
}
