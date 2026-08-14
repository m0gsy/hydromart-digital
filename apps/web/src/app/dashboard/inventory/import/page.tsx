'use client';

import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  {
    key: 'itemType',
    required: true,
    example: 'GALON',
    options: ['AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK'],
  },
  // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
  { key: 'label', required: true, example: 'Galon 19L' },
  { key: 'unit', required: true, example: 'unit' },
  { key: 'quantity', example: '100', parse: intCell },
  { key: 'minimumStock', example: '20', parse: intCell },
  { key: 'sellPrice', example: '', parse: intCell },
  // Either identifies the product on a PRODUK row. `sku` is the one a human can actually
  // type; productId stays for files exported from elsewhere and wins if both are filled.
  { key: 'sku', example: 'AIR-19L', text: true },
  { key: 'productId', example: '', text: true },
];

export default function ImportInventoryPage() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — see the note in the pelanggan import: "Semua depot" would
  // silently resolve to depots[0] and pour the whole stock file into the wrong depot.
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.importsInventory.title"
      description="Unggah Excel atau CSV untuk membuat banyak baris stok sekaligus. Baris PRODUK wajib mengisi sku (kode produk di katalog) atau productId; baris stok mentah harus mengosongkan keduanya. Nama dan satuan baris PRODUK diambil dari katalog, apa pun yang ditulis di kolom label."
      columns={COLUMNS}
      endpoint={endpoints.inventory.import(selectedId)}
      templateName="stok"
    />
  );
}
