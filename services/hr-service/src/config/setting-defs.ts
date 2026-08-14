import { SettingType } from '@hydromart/platform';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
  /**
   * `string` settings only: anchored regex the value must match. `min`/`max` cannot police
   * a string, and a CSV something downstream has to parse fails at the reader rather than
   * at the person who typed it otherwise. Enforced by SettingsSliceService.put.
   */
  pattern?: string;
  /** Global-only tunable: no per-depot override is offered (server rejects DEPOT scope). */
  global?: boolean;
}

// SalaryConfiguration business tunables. Env keys stay the boot-time fallback; values
// here are the documented defaults so the UI can show "ikut default (N)" before any override.
// envDefault must mirror this service's env.validation.ts defaults.
export const SETTING_DEFS: SettingDef[] = [
  { key: 'workStartTime', label: 'Jam masuk', type: 'string', unit: 'HH:MM', envDefault: '08:00' },
  {
    key: 'lateToleranceMinutes',
    label: 'Toleransi keterlambatan',
    type: 'int',
    unit: 'menit',
    min: 0,
    max: 120,
    envDefault: 15,
  },
  {
    key: 'lateDeductionAmount',
    label: 'Potongan terlambat',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 1000000,
    envDefault: 10000,
  },
  {
    key: 'dailyRateTraining',
    label: 'Upah harian training',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 10000000,
    envDefault: 30000,
  },
  {
    key: 'absenceDeductionAmount',
    label: 'Potongan absen',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 10000000,
    envDefault: 0,
  },
  {
    key: 'standardWorkingMinutes',
    label: 'Jam kerja standar',
    type: 'int',
    unit: 'menit',
    min: 0,
    max: 1440,
    envDefault: 480,
  },
  {
    key: 'annualLeaveQuotaDays',
    label: 'Kuota cuti tahunan',
    type: 'int',
    unit: 'hari kerja',
    min: 0,
    max: 60,
    envDefault: 12,
  },
  {
    key: 'weeklyOffDays',
    label: 'Hari libur mingguan',
    type: 'string',
    unit: '0=Min..6=Sab, koma',
    envDefault: '',
  },
  // M24-17. Multipliers are stored ×100 so the settings store stays integer-only
  // (150 = 1.5×). 0 on the ordinary multiplier switches overtime pay off entirely.
  {
    key: 'overtimeMultiplierPct',
    label: 'Pengali lembur hari kerja',
    type: 'int',
    unit: '% (150 = 1,5x)',
    min: 0,
    max: 500,
    envDefault: 150,
  },
  {
    key: 'overtimeOffDayMultiplierPct',
    label: 'Pengali lembur hari libur',
    type: 'int',
    unit: '% (200 = 2x)',
    min: 0,
    max: 500,
    envDefault: 200,
  },
  // Q-13 statutory payroll. Percentages are stored ×100 so the settings store stays
  // integer-only (100 = 1.00%). Every one of these moves on the government's schedule,
  // not ours — an accountant must be able to correct them without a deploy. Legal source
  // is named against each so a reader can check the number, not just trust it.
  {
    // Perpres 64/2020: 5% of wage, 1% employee / 4% employer.
    key: 'bpjsHealthEmployeePctX100',
    label: 'BPJS Kesehatan — potongan karyawan',
    type: 'int',
    unit: '% ×100 (100 = 1,00%)',
    min: 0,
    max: 2000,
    envDefault: 100,
  },
  {
    key: 'bpjsHealthCeilingIdr',
    label: 'BPJS Kesehatan — batas upah',
    type: 'int',
    unit: 'IDR/bulan (0 = tanpa batas)',
    min: 0,
    envDefault: 12_000_000,
  },
  {
    // PP 46/2015: JHT 5,7% total, 2% employee. No wage ceiling.
    key: 'bpjsJhtEmployeePctX100',
    label: 'BPJS JHT — potongan karyawan',
    type: 'int',
    unit: '% ×100 (200 = 2,00%)',
    min: 0,
    max: 2000,
    envDefault: 200,
  },
  {
    // PP 45/2015: JP 3% total, 1% employee, wage ceiling re-issued annually by BPJS.
    key: 'bpjsJpEmployeePctX100',
    label: 'BPJS Jaminan Pensiun — potongan karyawan',
    type: 'int',
    unit: '% ×100 (100 = 1,00%)',
    min: 0,
    max: 2000,
    envDefault: 100,
  },
  {
    key: 'bpjsJpCeilingIdr',
    label: 'BPJS Jaminan Pensiun — batas upah',
    type: 'int',
    unit: 'IDR/bulan (0 = tanpa batas)',
    min: 0,
    envDefault: 10_547_400,
  },
  {
    // PMK 250/PMK.03/2008: biaya jabatan 5% of gross, capped Rp 500.000/month.
    key: 'occupationalCostPctX100',
    label: 'Biaya jabatan',
    type: 'int',
    unit: '% ×100 (500 = 5,00%)',
    min: 0,
    max: 2000,
    envDefault: 500,
  },
  {
    key: 'occupationalCostCapIdr',
    label: 'Biaya jabatan — batas',
    type: 'int',
    unit: 'IDR/bulan',
    min: 0,
    envDefault: 500_000,
  },
  {
    // UU 36/2008 Article 21(5a): 20% higher rate for an employee with no NPWP.
    key: 'noNpwpSurchargePct',
    label: 'Tambahan PPh 21 tanpa NPWP',
    type: 'int',
    unit: '%',
    min: 0,
    max: 100,
    envDefault: 20,
  },
  {
    key: 'tenureRaiseLadder',
    label: 'Kenaikan gaji masa kerja (Kepala Depot)',
    type: 'string',
    unit: 'tahun:persen, koma (mis. 1:5,2:10)',
    envDefault: '',
  },
  // Depot SOP: denda telat bertingkat, per jabatan. Three rupiah steps in the order the
  // SOP table prints them — telat 1, telat 2, tidak absen. Empty = the depot keeps the flat
  // `lateDeductionAmount` above, so no existing depot's payroll moves on its own.
  {
    key: 'lateFineStaff',
    label: 'Denda telat bertingkat — staf',
    type: 'string',
    unit: 'telat1,telat2,tidakAbsen (Rp)',
    envDefault: '',
    pattern: '^$|^\\d+,\\d+,\\d+$',
  },
  /**
   * The three TER tables (PMK 168/2023), as JSON, per category.
   *
   * A setting rather than a constant for the same reason every other rate here is one:
   * the numbers are a regulation, they move on the regulator's schedule, and an accountant
   * must be able to load them without a deploy. It ships EMPTY, and empty means the
   * annualised progressive method keeps running — see domain/statutory.ts.
   *
   * Shape: {"A":[{"upToIdr":5400000,"rate":0},…],"B":[…],"C":[…]} with the top band of each
   * category open-ended (`upToIdr: null`). `assertTerTable` refuses anything partial,
   * unsorted, or with a percentage typed as a whole number.
   */
  {
    key: 'pph21TerTableJson',
    label: 'Tabel TER PPh 21 (PMK 168/2023)',
    type: 'string',
    unit: 'JSON per kategori A/B/C',
    envDefault: '',
  },
  {
    key: 'lateFineManager',
    label: 'Denda telat bertingkat — kepala depot',
    type: 'string',
    unit: 'telat1,telat2,tidakAbsen (Rp)',
    envDefault: '',
    pattern: '^$|^\\d+,\\d+,\\d+$',
  },
  // Both boundaries are minutes AFTER `workStartTime`, not clock times — the same frame
  // `lateToleranceMinutes` already uses, and the frame `Attendance.lateMinutes` is recorded
  // in. For the SOP's 07:50 start that makes 09:00 = 70 and 10:00 = 130. 0 = step disabled.
  {
    key: 'lateTier2AfterMinutes',
    label: 'Batas denda telat 2',
    type: 'int',
    unit: 'menit setelah jam masuk (0 = nonaktif)',
    min: 0,
    max: 1440,
    envDefault: 0,
  },
  {
    key: 'absentAfterMinutes',
    label: 'Batas dianggap tidak absen',
    type: 'int',
    unit: 'menit setelah jam masuk (0 = nonaktif)',
    min: 0,
    max: 1440,
    envDefault: 0,
  },
  // Depot SOP: a daily gallon-sales target ladder paid IN FULL to every staff member who
  // attended that day. Separate from the bonus-rule engine, which is monthly and reckons in
  // IDR — a daily gallon step cannot be expressed as a metric there. Empty = feature off.
  {
    key: 'dailySalesBonusTiers',
    label: 'Bonus target penjualan harian (galon)',
    type: 'string',
    unit: 'galon:rupiah, koma (mis. 120:15000,150:20000)',
    envDefault: '',
    pattern: '^$|^\\d+:\\d+(,\\d+:\\d+)*$',
  },
  {
    key: 'geofenceLat',
    label: 'Titik absen — lintang',
    type: 'string',
    unit: 'desimal (mis. -6.2001)',
    envDefault: '',
  },
  {
    key: 'geofenceLng',
    label: 'Titik absen — bujur',
    type: 'string',
    unit: 'desimal (mis. 106.8123)',
    envDefault: '',
  },
  {
    key: 'geofenceRadiusM',
    label: 'Radius absen (geofence)',
    type: 'int',
    unit: 'meter (0 = nonaktif)',
    min: 0,
    max: 5000,
    envDefault: 0,
  },
  // Offline punches carry a device timestamp. Anything that reaches us quickly is
  // indistinguishable from a live punch (geofence and face are re-checked server-side either
  // way), so only the ones that sat on the device long enough for the clock to matter go to HR.
  {
    key: 'offlineAutoAcceptMinutes',
    label: 'Absen offline lolos otomatis',
    type: 'int',
    unit: 'menit (0 = selalu minta persetujuan)',
    min: 0,
    max: 240,
    envDefault: 10,
  },
  {
    key: 'offlineMaxAgeHours',
    label: 'Batas usia absen offline',
    type: 'int',
    unit: 'jam',
    min: 1,
    max: 168,
    envDefault: 24,
  },
  // Performance scoring (C2). The three weights need not add to 100 — the score renormalises
  // them, and it renormalises again whenever a component cannot be measured at all.
  {
    key: 'perfWeightAttendance',
    label: 'Bobot kehadiran',
    type: 'int',
    unit: 'bobot',
    min: 0,
    max: 100,
    envDefault: 40,
  },
  {
    key: 'perfWeightDiscipline',
    label: 'Bobot kedisiplinan',
    type: 'int',
    unit: 'bobot',
    min: 0,
    max: 100,
    envDefault: 30,
  },
  {
    key: 'perfWeightSales',
    label: 'Bobot penjualan',
    type: 'int',
    unit: 'bobot',
    min: 0,
    max: 100,
    envDefault: 30,
  },
  {
    key: 'perfSalesTargetMonthly',
    label: 'Target penjualan depot per bulan',
    type: 'money',
    unit: 'Rp (0 = tanpa target)',
    min: 0,
    max: 100000000000,
    envDefault: 0,
  },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
