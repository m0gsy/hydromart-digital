'use client';

import { useMemo, useState } from 'react';
import { useT } from '@/lib/locale-context';

import { STAFF_IMPORT_ROLES } from '@hydromart/access';
import {
  CsvImport,
  dateCell,
  intCell,
  phoneCell,
  type ImportColumn,
} from '@/components/csv-import';
import { LoadError } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';
import {
  EMPLOYMENT_STATUS_LABEL,
  GENDER_LABEL,
  PTKP_STATUS_LABEL,
  type Department,
  type EmploymentStatus,
  type Gender,
  type PtkpStatus,
  type Shift,
} from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

// Imported, not re-listed: the server validates the `role` column against this exact
// allowlist, so a local copy could only ever offer a value the import will reject.
const STAFF_ROLES = STAFF_IMPORT_ROLES;

// Straight from the enum the server validates against. It used to offer CONTRACT (rejected
// on arrival) and hide TRAINING (the class most new hires are in).
const EMPLOYMENT_STATUSES = Object.keys(EMPLOYMENT_STATUS_LABEL) as EmploymentStatus[];
const GENDERS = Object.keys(GENDER_LABEL) as Gender[];
const PTKP_STATUSES = Object.keys(PTKP_STATUS_LABEL) as PtkpStatus[];

/** 16-digit KTP number. Excel turns it into 3.2E+15 unless the column is Text. */
function nikCell(raw: string): string {
  const value = raw.replace(/\s/g, '');
  if (/e[+-]?\d+$/i.test(value)) {
    throw new Error(`"${raw}" rusak jadi notasi ilmiah oleh Excel — format kolom NIK sebagai Teks`);
  }
  if (!/^\d{16}$/.test(value)) throw new Error(`"${raw}" harus 16 digit angka`);
  return value;
}

export default function ImportEmployeesPage() {
  const { t } = useT();
  const { depots } = useDepot();
  const [upsert, setUpsert] = useState(false);
  const departments = useAsync<Department[]>(
    () => api.get<Department[]>(endpoints.hr.departments(), true),
    [],
  );
  const shifts = useAsync<Shift[]>(() => api.get<Shift[]>(endpoints.hr.shifts(), true), []);
  const deptRows = useMemo(() => departments.data ?? [], [departments.data]);
  const shiftRows = useMemo(() => (shifts.data ?? []).filter((s) => s.active), [shifts.data]);

  // `depotCode` in, `depotId` out: nobody should be typing a UUID into a spreadsheet.
  // The console already holds the depot list, so the lookup costs no round-trip — and
  // the server still checks the resolved id against the caller's depot scope.
  const columns = useMemo<ImportColumn[]>(
    () => [
      // Optional: fill it to carry codes over from an older system, leave it blank and the
      // server mints HR-####. It is also the key an UPSERT run matches on.
      { key: 'employeeCode', example: '', text: true },
      { key: 'fullName', required: true, example: 'Budi Santoso' },
      { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
      {
        key: 'depotCode',
        field: 'depotId',
        required: true,
        example: depots[0]?.code ?? 'JKT-01',
        text: true,
        options: depots.map((d) => d.code),
        parse: (raw) => {
          const match = depots.find((d) => d.code.toUpperCase() === raw.toUpperCase());
          if (!match) throw new Error(`kode depot "${raw}" tidak dikenal`);
          return match.id;
        },
      },
      { key: 'position', required: true, example: 'Kurir' },
      // Optional, same code-not-UUID trick as depotCode. Blank = "Belum diatur"; the server
      // still rejects a unit that belongs to another depot.
      {
        key: 'departmentCode',
        field: 'departmentId',
        example: deptRows[0]?.code ?? '',
        text: true,
        options: deptRows.map((d) => d.code),
        parse: (raw) => {
          const match = deptRows.find((d) => d.code.toUpperCase() === raw.toUpperCase());
          if (!match) throw new Error(`kode departemen "${raw}" tidak dikenal`);
          return match.id;
        },
      },
      // The login role provisioned for this person. auth-service rejects anything
      // outside STAFF_IMPORT_ROLES, so a spreadsheet can never mint an office account.
      { key: 'role', required: true, example: 'STAFF_DEPOT', options: STAFF_ROLES },
      {
        key: 'employmentStatus',
        required: true,
        example: 'PROBATION',
        options: EMPLOYMENT_STATUSES,
      },
      { key: 'joinDate', required: true, example: '2026-01-01', text: true, parse: dateCell },
      // Only a reminder for whoever renews it — nothing expires anybody automatically.
      { key: 'contractEndDate', example: '', text: true, parse: dateCell },
      // The leaver column. This is the date payroll stops at — a RESIGNED status alone does
      // not end a wage — so an import that closes a batch of leavers must be able to say it.
      { key: 'exitDate', example: '', text: true, parse: dateCell },
      { key: 'salaryType', required: true, example: 'DAILY', options: ['DAILY', 'MONTHLY'] },
      { key: 'dailyRate', example: '150000', parse: intCell },
      { key: 'monthlyRate', example: '', parse: intCell },
      // Resolved on the server AFTER every row is in, so a manager further down the same
      // file still resolves.
      { key: 'supervisorCode', example: '', text: true },
      {
        key: 'shiftName',
        field: 'shiftId',
        example: shiftRows[0]?.name ?? '',
        options: shiftRows.map((s) => s.name),
        parse: (raw) => {
          const match = shiftRows.find((s) => s.name.toUpperCase() === raw.toUpperCase());
          if (!match) throw new Error(`shift "${raw}" tidak dikenal`);
          return match.id;
        },
      },
      { key: 'email', example: '' },
      { key: 'nik', example: '', text: true, parse: nikCell },
      { key: 'birthDate', example: '', text: true, parse: dateCell },
      { key: 'gender', example: '', options: GENDERS },
      { key: 'address', example: '' },
      { key: 'ptkpStatus', example: '', options: PTKP_STATUSES },
      { key: 'npwp', example: '', text: true },
      { key: 'bpjsKes', example: '', text: true },
      { key: 'bpjsTk', example: '', text: true },
      { key: 'bankName', example: '' },
      { key: 'bankAccount', example: '', text: true },
      { key: 'emergencyName', example: '' },
      { key: 'emergencyPhone', example: '', text: true, parse: phoneCell },
    ],
    [depots, deptRows, shiftRows],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Department and shift columns are validated AGAINST these two lists, so an unread
          list rejects every row with "kode departemen tidak dikenal" — which reads as a bad
          spreadsheet, and the operator edits a file that was right all along. */}
      {(departments.error || shifts.error) && (
        <LoadError
          onRetry={() => {
            if (departments.error) departments.reload();
            if (shifts.error) shifts.reload();
          }}
        />
      )}

      <label className="flex items-start gap-3 rounded-lg border border-app p-4 text-sm">
        <input
          type="checkbox"
          checked={upsert}
          onChange={(e) => setUpsert(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-semibold">{t('hrFix.hrImport.upsert')}</span>
          <span className="block text-[12.5px] text-muted">
            Baris yang cocok (kode karyawan, lalu NIK, lalu no. HP) ditimpa dengan isi file —
            dipakai untuk kenaikan gaji atau pindah departemen massal. Tanpa centang ini, karyawan
            yang sudah ada dilewati. Role login tidak pernah ikut berubah.
          </span>
        </span>
      </label>

      <CsvImport
        title="hrFix.hrImport.title"
        description="Unggah Excel atau CSV untuk menambah banyak karyawan sekaligus. Setiap baris baru juga dibuatkan akun login (OTP) sesuai kolom role, dan langsung tertaut ke depot yang ditulis."
        columns={columns}
        endpoint={endpoints.hr.importEmployees}
        templateName="karyawan"
        body={{ mode: upsert ? 'UPSERT' : 'CREATE' }}
      />
    </div>
  );
}
