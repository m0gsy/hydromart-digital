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

// Business tunables ONLY. Env keys stay the boot-time fallback; values here are the
// documented defaults so the UI can show "ikut default (N)" before any override.
// envDefault must mirror this service's env.validation.ts defaults
export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'shiftLengthHours',
    label: 'Durasi shift',
    type: 'int',
    unit: 'jam',
    min: 1,
    max: 24,
    envDefault: 8,
  },
  {
    key: 'shiftBreakQuotaMinutes',
    label: 'Kuota istirahat',
    type: 'int',
    unit: 'menit',
    min: 0,
    max: 240,
    envDefault: 60,
  },
  {
    key: 'shiftCheckInRadiusMeters',
    label: 'Radius check-in',
    type: 'int',
    unit: 'meter',
    min: 10,
    max: 2000,
    envDefault: 200,
  },
  // Cap on how far back a queued offline capture (shift check-in, proof of delivery) may
  // date itself once the courier reconnects.
  {
    key: 'offlineMaxAgeHours',
    label: 'Batas usia data offline',
    type: 'int',
    unit: 'jam',
    min: 1,
    max: 48,
    envDefault: 12,
  },
  {
    key: 'maxActiveDeliveriesPerDriver',
    label: 'Maks pengiriman aktif / kurir',
    type: 'int',
    min: 1,
    max: 20,
    envDefault: 1,
  },
  {
    key: 'slaMinutes',
    label: 'SLA pengiriman',
    type: 'int',
    unit: 'menit',
    min: 15,
    max: 600,
    envDefault: 120,
  },
  {
    key: 'urbanSpeedKmph',
    label: 'Kecepatan rata-rata kota (ETA)',
    type: 'number',
    unit: 'km/jam',
    min: 5,
    max: 60,
    envDefault: 18,
  },
  // The other half of the multi-stop ETA. The courier route screen used to add a flat
  // 4 minutes per drop from a literal in the browser, next to a literal 3 min/km that
  // ignored urbanSpeedKmph entirely — so the depot could tune the speed and the screen
  // would not move. Both halves are settings now, and the screen reads them.
  {
    key: 'routeStopMinutes',
    label: 'Waktu per perhentian (ETA rute)',
    type: 'number',
    unit: 'menit',
    min: 0,
    max: 60,
    envDefault: 4,
  },
  {
    key: 'courierWeeklyTarget',
    label: 'Target mingguan kurir',
    type: 'int',
    unit: 'order',
    min: 0,
    max: 1000,
    envDefault: 45,
  },
  {
    key: 'noShowMinContactAttempts',
    label: 'Min. percobaan kontak sebelum no-show',
    type: 'int',
    min: 1,
    max: 10,
    envDefault: 2,
  },
  {
    key: 'noShowMinWaitSeconds',
    label: 'Min. tunggu sebelum no-show',
    type: 'int',
    unit: 'detik',
    min: 0,
    max: 3600,
    envDefault: 300,
  },
  /*
   * C1 kill switch. On (1), the expected deposit for a shift is decided per order as
   * `max(codAmount, cash PAID)`; off (0), it goes back to summing PAID cash alone.
   * `SettingType` has no boolean, so 0/1 int — the documented shape for a switch here.
   *
   * The escape hatch it exists for: if `codAmount` turns out to be stale on old rows,
   * this stops it manufacturing shortfalls across a whole depot without a deploy.
   */
  {
    key: 'settlementExpectFromCod',
    label: 'Ekspektasi setoran dari COD',
    type: 'int',
    min: 0,
    max: 1,
    envDefault: 1,
  },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
