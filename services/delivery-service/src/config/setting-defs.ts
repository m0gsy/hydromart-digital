import { SettingType } from '@hydromart/platform';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
}

// Business tunables ONLY. Env keys stay the boot-time fallback; values here are the
// documented defaults so the UI can show "ikut default (N)" before any override.
export const SETTING_DEFS: SettingDef[] = [
  { key: 'shiftLengthHours', label: 'Durasi shift', type: 'int', unit: 'jam', min: 1, max: 24, envDefault: 8 },
  { key: 'shiftBreakQuotaMinutes', label: 'Kuota istirahat', type: 'int', unit: 'menit', min: 0, max: 240, envDefault: 60 },
  { key: 'shiftCheckInRadiusMeters', label: 'Radius check-in', type: 'int', unit: 'meter', min: 10, max: 2000, envDefault: 150 },
  { key: 'maxActiveDeliveriesPerDriver', label: 'Maks pengiriman aktif / kurir', type: 'int', min: 1, max: 20, envDefault: 1 },
  { key: 'slaMinutes', label: 'SLA pengiriman', type: 'int', unit: 'menit', min: 15, max: 600, envDefault: 120 },
  { key: 'urbanSpeedKmph', label: 'Kecepatan rata-rata kota (ETA)', type: 'number', unit: 'km/jam', min: 5, max: 60, envDefault: 18 },
  { key: 'courierWeeklyTarget', label: 'Target mingguan kurir', type: 'int', unit: 'order', min: 0, max: 1000, envDefault: 60 },
  { key: 'courierRatePerDeliveryIdr', label: 'Komisi per pengiriman', type: 'money', unit: 'Rp', min: 0, max: 1000000, envDefault: 12000 },
  { key: 'noShowMinContactAttempts', label: 'Min. percobaan kontak sebelum no-show', type: 'int', min: 1, max: 10, envDefault: 2 },
  { key: 'noShowMinWaitSeconds', label: 'Min. tunggu sebelum no-show', type: 'int', unit: 'detik', min: 0, max: 3600, envDefault: 300 },
  { key: 'podRetentionDays', label: 'Retensi bukti pengiriman', type: 'int', unit: 'hari', min: 30, max: 3650, envDefault: 365 },
];

export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d]),
);
