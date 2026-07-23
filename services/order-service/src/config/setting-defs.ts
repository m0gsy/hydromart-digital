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
// envDefault must mirror this service's env.validation.ts defaults
export const SETTING_DEFS: SettingDef[] = [
  { key: 'deliveryFee', label: 'Ongkir per galon', type: 'money', unit: 'Rp', min: 0, max: 100000, envDefault: 1000 },
  { key: 'abandonMinutes', label: 'Batas keranjang terbengkalai', type: 'int', unit: 'menit', min: 5, max: 1440, envDefault: 60 },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
