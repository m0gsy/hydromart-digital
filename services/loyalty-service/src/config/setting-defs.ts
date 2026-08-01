import { SettingType } from '@hydromart/platform';

import { MembershipTier, TIER_BENEFITS } from '../domain/membership';

/** Setting keys carrying each paid tier's ladder rung. REGULAR is fixed (0 poin, 0%). */
export const TIER_SETTING_KEYS: Record<MembershipTier, { threshold: string; discountPct: string }> = {
  [MembershipTier.REGULAR]: { threshold: 'regularThreshold', discountPct: 'regularDiscountPct' },
  [MembershipTier.SILVER]: { threshold: 'silverThreshold', discountPct: 'silverDiscountPct' },
  [MembershipTier.GOLD]: { threshold: 'goldThreshold', discountPct: 'goldDiscountPct' },
  [MembershipTier.PLATINUM]: { threshold: 'platinumThreshold', discountPct: 'platinumDiscountPct' },
};

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
    key: 'earnRateRupiah',
    label: 'Rupiah per 1 poin',
    type: 'money',
    unit: 'Rp',
    min: 1,
    max: 1000000,
    envDefault: 1000,
  },
  {
    key: 'pointExpiryMonths',
    label: 'Masa berlaku poin',
    type: 'int',
    unit: 'bulan',
    min: 1,
    max: 120,
    envDefault: 12,
  },
  // Membership ladder (FR-014 tier, FR-032 discount). Unlike the two above these have no
  // env key: their documented default is the TIER_BENEFITS domain constant, which the
  // config getter reads directly — six env vars for numbers that already live in one
  // table would be two sources of truth, not one.
  //
  // Per-depot overrides are allowed on BOTH threshold and rate, so a depot decides who
  // counts as GOLD there and what GOLD costs it. A customer's stored tier stays the
  // GLOBAL one (their card, their history); the depot table only re-derives the tier and
  // rate that apply while shopping at that depot.
  //
  // Rates are whole percent, not the 0.02 fraction the domain uses — an operator types
  // "5", and the config getter divides. Capped at 50%: past that a "discount" is a
  // pricing decision, not a loyalty perk.
  ...TIER_BENEFITS.filter((b) => b.tier !== MembershipTier.REGULAR).flatMap(
    (b): SettingDef[] => [
      {
        key: TIER_SETTING_KEYS[b.tier].threshold,
        label: `${b.tier} — poin minimum`,
        type: 'int',
        unit: 'poin',
        min: 1,
        max: 10_000_000,
        envDefault: b.threshold,
      },
      {
        key: TIER_SETTING_KEYS[b.tier].discountPct,
        label: `${b.tier} — diskon`,
        type: 'int',
        unit: '%',
        min: 0,
        max: 50,
        envDefault: Math.round(b.discountRate * 100),
      },
    ],
  ),
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
