'use client';

import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Toko Berkah' },
  { key: 'phone', required: true, example: '081234567890' },
  { key: 'discountPct', required: true, example: '5', parse: intCell },
  { key: 'monthlyTargetQty', required: true, example: '100', parse: intCell },
  { key: 'joinDate', required: true, example: '2026-01-01' },
  { key: 'note', example: '' },
];

export default function ImportResellersPage() {
  const { scopedId } = useDepot();

  if (!scopedId) {
    return <CenterState title="Pilih depot dulu di pemilih depot" />;
  }

  return (
    <CsvImport
      title="Import Reseller / Agen"
      description="Nomor yang belum punya akun akan didaftarkan lebih dulu, lalu terdaftar sebagai reseller depot ini dengan persen diskonnya."
      columns={COLUMNS}
      endpoint={endpoints.resellers.import}
      templateName="reseller.csv"
      body={{ depotId: scopedId }}
    />
  );
}
