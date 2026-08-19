import { SettingType } from '@hydromart/platform';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
  /** `string` settings only: regex the written value must match (see the platform slice). */
  pattern?: string;
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
  // Delivery timing, which used to live in the checkout page as three constants: the
  // slot list, the express surcharge and its ETA. The surcharge in particular was shown
  // to the customer and never charged — order pricing had no express component at all —
  // so this is the money path, not a preference screen.
  //
  // Per-depot on purpose: a depot with one courier does not offer the same windows, or
  // the same "now", as a depot with six.
  {
    key: 'expressEnabled',
    label: 'Antar sekarang (1 = tawarkan, 0 = jangan)',
    type: 'int',
    min: 0,
    max: 1,
    envDefault: 1,
  },
  {
    key: 'expressFee',
    label: 'Biaya antar sekarang',
    type: 'money',
    unit: 'Rp',
    min: 0,
    max: 1000000,
    envDefault: 5000,
  },
  {
    key: 'expressEtaMinMinutes',
    label: 'Estimasi antar sekarang (tercepat)',
    type: 'int',
    unit: 'menit',
    min: 5,
    max: 480,
    envDefault: 30,
  },
  {
    key: 'expressEtaMaxMinutes',
    label: 'Estimasi antar sekarang (terlama)',
    type: 'int',
    unit: 'menit',
    min: 5,
    max: 480,
    envDefault: 60,
  },
  // Comma-separated `HH.MM-HH.MM`, in the order they should be offered. The pattern is
  // enforced on write: this string is parsed by the checkout screen, and a typo here
  // would otherwise surface as a missing or malformed slot in front of a customer.
  {
    key: 'deliverySlots',
    label: 'Slot jam antar (pisah koma, contoh 09.00-11.00)',
    type: 'string',
    envDefault: '09.00-11.00,11.00-13.00,13.00-15.00,15.00-17.00,17.00-19.00',
    pattern: '^\\d{2}\\.\\d{2}-\\d{2}\\.\\d{2}(,\\d{2}\\.\\d{2}-\\d{2}\\.\\d{2})*$',
  },
  // A1's kill switch. `SettingType` has no boolean, so it is an int pinned to 0/1 like
  // `expressEnabled`. 1 = the cart quotes the depot's own price (what checkout bills);
  // 0 = the cart goes back to catalog base prices and says so via `pricingBasis`.
  // Per-depot, because the blast radius of a bad depot price row is one depot.
  {
    key: 'cartDepotPricing',
    label: 'Keranjang pakai harga depot (1 = ya, 0 = harga katalog)',
    type: 'int',
    min: 0,
    max: 1,
    envDefault: 1,
  },
  // B1's kill switch. Off takes the "Selesaikan" button off the depot queue and leaves
  // delivery-service's own DELIVERED->COMPLETED path exactly as it is. Int 0/1 because
  // `SettingType` has no boolean, same shape as `expressEnabled`.
  {
    key: 'staffCompleteDelivered',
    label: 'Staf boleh menyelesaikan pesanan terkirim (1 = ya, 0 = tidak)',
    type: 'int',
    min: 0,
    max: 1,
    envDefault: 1,
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
