import { SettingType } from '@hydromart/platform';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
  /** Global-only tunable: no per-depot override is offered (server rejects DEPOT scope). */
  global?: boolean;
}

// SalaryConfiguration business tunables. Env keys stay the boot-time fallback; values
// here are the documented defaults so the UI can show "ikut default (N)" before any override.
// envDefault must mirror this service's env.validation.ts defaults.
export const SETTING_DEFS: SettingDef[] = [
  { key: 'workStartTime', label: 'Jam masuk', type: 'string', unit: 'HH:MM', envDefault: '08:00' },
  { key: 'lateToleranceMinutes', label: 'Toleransi keterlambatan', type: 'int', unit: 'menit', min: 0, max: 120, envDefault: 15 },
  { key: 'lateDeductionAmount', label: 'Potongan terlambat', type: 'money', unit: 'Rp', min: 0, max: 1000000, envDefault: 10000 },
  { key: 'dailyRateTraining', label: 'Upah harian training', type: 'money', unit: 'Rp', min: 0, max: 10000000, envDefault: 30000 },
  { key: 'absenceDeductionAmount', label: 'Potongan absen', type: 'money', unit: 'Rp', min: 0, max: 10000000, envDefault: 0 },
  { key: 'standardWorkingMinutes', label: 'Jam kerja standar', type: 'int', unit: 'menit', min: 0, max: 1440, envDefault: 480 },
  { key: 'weeklyOffDays', label: 'Hari libur mingguan', type: 'string', unit: '0=Min..6=Sab, koma', envDefault: '' },
  { key: 'tenureRaiseLadder', label: 'Kenaikan gaji masa kerja (Kepala Depot)', type: 'string', unit: 'tahun:persen, koma (mis. 1:5,2:10)', envDefault: '' },
  { key: 'geofenceLat', label: 'Titik absen — lintang', type: 'string', unit: 'desimal (mis. -6.2001)', envDefault: '' },
  { key: 'geofenceLng', label: 'Titik absen — bujur', type: 'string', unit: 'desimal (mis. 106.8123)', envDefault: '' },
  { key: 'geofenceRadiusM', label: 'Radius absen (geofence)', type: 'int', unit: 'meter (0 = nonaktif)', min: 0, max: 5000, envDefault: 0 },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
