'use client';

import { CsvImport, type ImportColumn } from '@/components/csv-import';
import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Siti Aminah' },
  { key: 'phone', required: true, example: '081234567890' },
  { key: 'addressLine', example: 'Jl. Melati 3 No. 7 RT 04' },
  { key: 'city', example: 'Bekasi' },
  { key: 'province', example: 'Jawa Barat' },
  { key: 'landmark', example: 'pagar hijau sebelah warung Bu Ani' },
];

export default function ImportCustomersPage() {
  const { scopedId } = useDepot();

  if (!scopedId) {
    return <CenterState title="Pilih depot dulu di pemilih depot" />;
  }

  return (
    <CsvImport
      title="Import Pelanggan"
      description="Nomor yang diimpor didaftarkan lebih dulu. Pelanggan tetap mendaftar sendiri lewat OTP dengan nomor yang sama — akunnya langsung terhubung ke data ini. Isi alamat berarti kota dan provinsi wajib diisi."
      columns={COLUMNS}
      endpoint={endpoints.depotCrm.import}
      templateName="pelanggan.csv"
      body={{ depotId: scopedId }}
    />
  );
}
