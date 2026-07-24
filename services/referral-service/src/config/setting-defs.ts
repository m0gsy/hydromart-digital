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
  // Global-only: qualify() is a system-to-system call from order-service (customerId +
  // orderId only, no depotId — see QualifyReferralDto/ReferralController#qualify) and
  // ReferralService#qualify reads config.referrerPoints with no depot context in scope.
  // A per-depot override would be silently unreachable, so it is not offered.
  { key: 'referrerPoints', label: 'Poin untuk pengajak', type: 'int', unit: 'poin', min: 0, max: 100000, envDefault: 500, global: true },
  { key: 'refereePoints', label: 'Poin untuk yang diajak', type: 'int', unit: 'poin', min: 0, max: 100000, envDefault: 250, global: true },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
