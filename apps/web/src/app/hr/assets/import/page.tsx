'use client';

import { useMemo } from 'react';

import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const ASSET_TYPES = [
  'MOTORCYCLE',
  'SMARTPHONE',
  'UNIFORM',
  'LAPTOP',
  'PRINTER',
  'SCANNER',
  'OTHER',
] as const;

export default function ImportAssetsPage() {
  const { depots } = useDepot();

  const columns = useMemo<ImportColumn[]>(
    () => [
      { key: 'code', required: true, example: 'MTR-0001', text: true },
      { key: 'type', required: true, example: 'MOTORCYCLE', options: ASSET_TYPES },
      { key: 'name', required: true, example: 'Honda Vario 125' },
      {
        key: 'depotCode',
        field: 'depotId',
        required: true,
        example: depots[0]?.code ?? 'JKT-01',
        text: true,
        options: depots.map((d) => d.code),
        parse: (raw, t) => {
          const match = depots.find((d) => d.code.toUpperCase() === raw.toUpperCase());
          if (!match) throw new Error(t('opsFix.import.unknownDepotCode', { value: raw }));
          return match.id;
        },
      },
      { key: 'brand', example: '' },
      { key: 'serialNo', example: '', text: true },
      { key: 'value', example: '18000000', parse: intCell },
      // Blank = the asset sits in the depot. Filled = it is already in someone's hands, and
      // the import writes the hand-over into the movement log like any other transfer.
      { key: 'holderEmployeeCode', example: '', text: true },
      { key: 'note', example: '' },
    ],
    [depots],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="hrFix.imports.assets"
        description="Mendaftarkan aset perusahaan sekaligus, termasuk yang sudah dipegang karyawan. Penerima harus berada di depot yang sama dengan asetnya; jika tidak, asetnya tetap terdaftar tapi belum diserahkan."
        columns={columns}
        endpoint={endpoints.hr.importAssets}
        templateName="aset"
      />
    </div>
  );
}
