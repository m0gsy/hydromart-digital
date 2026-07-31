'use client';

import { CsvImport, phoneCell, type ImportColumn } from '@/components/csv-import';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Siti Aminah' },
  { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
  { key: 'addressLine', example: 'Jl. Melati 3 No. 7 RT 04' },
  { key: 'city', example: 'Bekasi' },
  { key: 'province', example: 'Jawa Barat' },
  { key: 'landmark', example: 'pagar hijau sebelah warung Bu Ani' },
];

export default function ImportCustomersPage() {
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId. An import writes into exactly one depot, and scopedId falls
  // back to depots[0] whenever the switcher says "Semua depot" — which would file every
  // row under whichever depot happened to sort first, with nothing on screen saying so.
  if (!selectedId) {
    return <CenterState title={ready ? 'Pilih satu depot dulu di pemilih depot' : 'Memuat depot…'} />;
  }

  return (
    <CsvImport
      title="Import Pelanggan"
      description="Nomor yang diimpor didaftarkan lebih dulu. Pelanggan tetap mendaftar sendiri lewat OTP dengan nomor yang sama — akunnya langsung terhubung ke data ini. Isi alamat berarti kota dan provinsi wajib diisi."
      columns={COLUMNS}
      endpoint={endpoints.depotCrm.import}
      templateName="pelanggan"
      body={{ depotId: selectedId }}
    />
  );
}
