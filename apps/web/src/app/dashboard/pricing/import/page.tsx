'use client';

import { CsvImport, intCell, numberCell, type ImportColumn } from '@/components/csv-import';
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
  { key: 'productName', required: true, example: 'Galon 19L' },
  { key: 'currentPrice', required: true, example: '20000', parse: intCell },
  { key: 'adjustType', required: true, example: 'PERCENT', options: ['PERCENT', 'FIXED'] },
  { key: 'value', required: true, example: '-10', parse: numberCell },
  { key: 'note', example: 'Menyesuaikan harga pesaing' },
];

export default function ImportPricesPage() {
  const { scopedId } = useDepot();

  if (!scopedId) {
    return <CenterState title="Pilih depot dulu di pemilih depot" />;
  }

  return (
    <CsvImport
      title="Import Harga Depot"
      description="Setiap baris menjadi usulan override harga dan tetap menunggu persetujuan HQ — tidak langsung berlaku."
      columns={COLUMNS}
      endpoint={endpoints.priceOverrides.import(scopedId)}
      templateName="harga-depot"
    />
  );
}
