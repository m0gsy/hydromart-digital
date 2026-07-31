'use client';

import { useMemo } from 'react';

import { CsvImport, phoneCell, type ImportColumn } from '@/components/csv-import';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page } from '@/lib/types';

// Staff roles HQ may mint, same set the single-invite form offers (design 4b/10c).
// CUSTOMER is absent by design: auth-service rejects it, and this wizard mints staff.
const STAFF_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'MARKETING',
  'FINANCE',
  'HR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'SUPER_ADMIN',
];

// Design 10c — bulk staff import. Shares the one <CsvImport> wizard with the other ten
// imports, so this page reads .xlsx as well as .csv and ships a real spreadsheet template.
// It used to hand-roll a CSV parse over readAsText, which meant an Excel file could not
// even be picked; the commit loop it also hand-rolled now lives behind one endpoint.
export default function HqStaffImportPage() {
  const depots = useAsync<Page<DepotAdmin>>(() =>
    api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true),
  );
  const depotRows = useMemo(() => depots.data?.items ?? [], [depots.data]);

  // `depotCode` in, `depotId` out — nobody types a UUID into a spreadsheet. The console
  // already holds the depot list, so the lookup costs no round-trip.
  const columns = useMemo<ImportColumn[]>(
    () => [
      { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
      { key: 'fullName', example: 'Budi Santoso' },
      { key: 'role', required: true, example: 'KEPALA_DEPOT', options: STAFF_ROLES },
      // Optional here, but auth-service REQUIRES it for the depot-locked roles (kurir and
      // kepala depot): such a row comes back failed with that reason rather than silently
      // creating an account nobody can use.
      {
        key: 'depotCode',
        field: 'depotId',
        example: depotRows[0]?.code ?? 'JKT-01',
        text: true,
        options: depotRows.map((d) => d.code),
        parse: (raw) => {
          const match = depotRows.find((d) => d.code.toUpperCase() === raw.toUpperCase());
          if (!match) throw new Error(`kode depot "${raw}" tidak dikenal`);
          return match.id;
        },
      },
    ],
    [depotRows],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <CsvImport
        title="Impor Staf Massal"
        description="Unggah Excel atau CSV untuk membuat banyak akun staf sekaligus. Mereka masuk lewat OTP dengan nomor yang ditulis. Nomor yang sudah punya akun tidak digandakan — perannya diperbarui. Kolom depot wajib diisi untuk peran Kurir dan Kepala Depot."
        columns={columns}
        endpoint={endpoints.auth.importStaff}
        templateName="staf"
      />
    </div>
  );
}
