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
  {
    key: 'deliveryFee',
    label: 'Ongkir per galon (fallback)',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 100000,
    envDefault: 1000,
    global: true,
  },
  {
    key: 'abandonMinutes',
    // M4-18: the old label said "keranjang terbengkalai", but this threshold is measured
    // on CREATED orders that were never confirmed, not on carts. The key keeps its name
    // so no stored override is orphaned; only the human-facing label changes.
    label: 'Batas order belum dikonfirmasi',
    type: 'int',
    unit: 'menit',
    min: 5,
    max: 1440,
    envDefault: 60,
  },
  // Spec 7b's "hemat 5%" on every subscription delivery. Per-depot like every other
  // money rate: the depot funds the discount, so the depot sets it. Whole percent —
  // an operator types "5" and the getter divides. Capped at 50%: past that a
  // "discount" is a pricing decision, not a subscription perk.
  {
    key: 'subscriptionDiscountPct',
    label: 'Diskon langganan',
    type: 'number',
    unit: '%',
    min: 0,
    max: 50,
    envDefault: 5,
  },
  // Divisor that turns a water-meter variance in litres into "setara galon". Nominal
  // fill volume, not the physical one: it only exists to express a leftover in a unit
  // an operator thinks in. Per-depot because a depot that sells 15L as its main line
  // wants its leftovers counted in 15L units.
  {
    key: 'meterReferenceVolumeMl',
    label: 'Isi galon acuan (rekonsiliasi meteran)',
    type: 'int',
    unit: 'ml',
    min: 1000,
    max: 100000,
    envDefault: 19000,
  },
  // Litres, not rupiah, on purpose: the rupiah figure is null on a day with no
  // delivered galon (nothing to derive a per-galon price from), and an alert that
  // goes quiet exactly when a depot sold nothing is the wrong alert.
  {
    key: 'meterVarianceToleranceLiters',
    label: 'Ambang selisih meteran air',
    type: 'int',
    unit: 'liter',
    min: 0,
    max: 100000,
    envDefault: 200,
  },
  {
    key: 'stalledHours',
    label: 'Batas pesanan mandek di depot',
    type: 'int',
    unit: 'jam',
    min: 1,
    max: 168,
    envDefault: 24,
  },
];

// Null-prototype so keys like `constructor`/`toString` don't resolve to inherited
// Object.prototype members and slip past the `if (!def) throw` unknown-key guard.
export const SETTING_DEF_BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);
