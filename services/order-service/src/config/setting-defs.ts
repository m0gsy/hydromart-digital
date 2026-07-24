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
  // Global-only fallback: real per-galon delivery fee is owned by depot-service
  // (Depot.deliveryFee, editable at dashboard/depots) and drives actual order pricing.
  // This key only feeds order.service when no depot routes the order.
  { key: 'deliveryFee', label: 'Ongkir per galon (fallback)', type: 'money', unit: 'Rp', min: 0, max: 100000, envDefault: 1000, global: true },
  { key: 'abandonMinutes', label: 'Batas keranjang terbengkalai', type: 'int', unit: 'menit', min: 5, max: 1440, envDefault: 60 },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
