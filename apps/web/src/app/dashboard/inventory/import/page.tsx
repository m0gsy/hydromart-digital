'use client';

import { CsvImport, enumCell, intCell, type ImportColumn } from '@/components/csv-import';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  {
    key: 'itemType',
    required: true,
    example: 'GALON',
    parse: enumCell(['AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK']),
  },
  { key: 'label', required: true, example: 'Galon 19L' },
  { key: 'unit', required: true, example: 'unit' },
  { key: 'quantity', example: '100', parse: intCell },
  { key: 'minimumStock', example: '20', parse: intCell },
  { key: 'sellPrice', example: '', parse: intCell },
  { key: 'productId', example: '' },
];

export default function ImportInventoryPage() {
  const { scopedId } = useDepot();

  if (!scopedId) {
    return <CenterState title="Pilih depot dulu di pemilih depot" />;
  }

  return (
    <CsvImport
      title="Import Stok"
      description="Unggah CSV untuk membuat banyak baris stok sekaligus. Baris PRODUK wajib mengisi productId; baris stok mentah harus mengosongkannya."
      columns={COLUMNS}
      endpoint={endpoints.inventory.import(scopedId)}
      templateName="stok.csv"
    />
  );
}
