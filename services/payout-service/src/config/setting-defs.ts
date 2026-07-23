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
  // Global-only: reporting-only HQ commission rate. The real per-depot payout
  // percentage is owned by CommissionScheme (design 21c, "Terapkan skema baru"),
  // an effective-dated table with its own apply endpoint — this key never feeds
  // that computation, so a per-depot override here would be meaningless.
  { key: 'commissionRate', label: 'Rate komisi payout', type: 'number', unit: 'rasio (0–1)', min: 0, max: 1, envDefault: 0.05, global: true },
  { key: 'expenseAutoApproveMaxIdr', label: 'Batas auto-approve klaim biaya', type: 'money', unit: 'Rp', min: 0, max: 10000000, envDefault: 50000 },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
