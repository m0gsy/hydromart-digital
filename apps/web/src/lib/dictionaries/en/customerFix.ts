// English mirror of id/customerFix.ts — SAME keys, English values.
export const customerFix = {
  /** D3: a subscription whose address cannot be routed delivers nothing, silently. */
  subscriptionUnroutable: "This plan cannot run yet: its address has no map pin. Open that address, tap \"Use my location\", then create the plan again.",
  /** I5: the customer's own gallon deposit — two numbers that lived only in the staff console. */
  gallonDeposit: {
    title: "Gallon deposit",
    subtitle: "Gallons you are still holding, and the deposit still with the depot.",
    gallons: "{n} gallons held",
    held: "Deposit held",
    empty: "You are not holding any gallons.",
    unavailable: "Not connected — the deposit data cannot be read right now.",
    note: "The deposit comes back when the gallons go back to the same depot.",
  },
  address: {
    pinRequired: "A map pin is required — tap \"Use my location\".",
  },
  depotOpen: {
    buka: "Open",
    istirahat: "On break",
    tutup: "Closed",
  },
  favorite: {
    remove: "Remove from favourites",
    save: "Save to favourites",
  },
  checkout: {
    agentPrice: "Agent price Rp{amount}/gallon",
    catalogPricing: "Estimated prices — the depot's own prices apply when the order is placed",
    resellerDiscount: "Reseller price −{pct}%",
    defaultAddressLabel: "Address",
  },
  // 13n — voucher not eligible (checkout)
  voucher: {
    shortfall: 'Spend {amount} more to unlock',
    addProduct: 'Add products',
    usableNow: 'Usable now',
    use: 'Use',
    min: 'Min. spend {min}',
    shortBy: '{amount} short',
  },
  // 13b — delivery slot (checkout)
  slot: {
    expressNow: 'Deliver now',
    expressEta: 'Est. {min}–{max} min',
    expressFee: '+{amount}',
    orSchedule: 'Or schedule',
    today: 'Today',
    tomorrow: 'Tomorrow',
    selected: 'selected',
    periodMorning: 'Morning',
    periodNoon: 'Midday',
    periodAfternoon: 'Afternoon',
    periodEvening: 'Evening',
    feeNote: 'The express fee is added when the depot confirms.',
  },
  // 13e — promo / campaign landing
  promo: {
    heroBadgeEnds: 'Ends {date}',
    endsIn: 'Ends in',
    ended: 'Promo ended',
    shopPromo: 'Shop promo',
    terms: 'Terms & conditions',
    claimVouchers: 'Claim voucher codes',
    copy: 'Copy',
    copied: 'Copied',
    promoProducts: 'Promo products',
    viewAll: 'View all',
    badge: 'Promo',
    empty: 'No active promos yet. Check back later.',
    dayLabel: 'Days',
    hourLabel: 'Hours',
    minLabel: 'Min',
    secLabel: 'Sec',
    heroFallbackTitle: 'Hydromart Promo',
    heroFallbackSubtitle: 'Refill discounts, free delivery, and bonus points for loyal customers.',
    term1: 'Promo applies to registered users during the campaign period.',
    term2: 'Voucher codes cannot be combined in a single transaction.',
    term3: 'Free delivery applies per the minimum spend from the nearest depot.',
    term4: 'Limited quota; Hydromart may change the terms at any time.',
  },
};
