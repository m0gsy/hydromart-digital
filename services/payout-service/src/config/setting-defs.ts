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
    key: 'expenseAutoApproveMaxIdr',
    label: 'Batas auto-approve klaim biaya',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 10000000,
    envDefault: 50000,
  },
  {
    // The platform's own cut of a depot's revenue, shown on the HQ reconciliation
    // statement. It lived there as `const PLATFORM_FEE_PCT = 0.05` — an invented rate
    // applied to REAL revenue on a page a franchise owner reads as what they are owed,
    // and the last such number left in the console. Nothing charges it anywhere in the
    // backend (the ledger has no platform-fee entry type), so this is a reporting rate,
    // not a posting one.
    //
    // Whole percent, like order-service's `subscriptionDiscountPct`; the reader divides.
    // envDefault 0 on purpose: no rate has ever been agreed, and a statement that reads
    // "—" until somebody sets one is honest, where 5% only looked authoritative.
    key: 'platformFeePct',
    label: 'Biaya platform (% dari penjualan depot)',
    type: 'number',
    unit: '%',
    min: 0,
    max: 100,
    envDefault: 0,
  },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
