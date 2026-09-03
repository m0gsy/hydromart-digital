// Strings for the HQ design-fidelity batch (matrix bulk-toggles + rail grouping).
// Kept out of hq.ts so parallel agents don't collide on one fragment.
export const hqFix = {
  // DEFECT-01 — see the Indonesian side.
  customers: {
    historyUnavailable: 'Order history could not be read right now — this is NOT a zero.',
    loyaltyUnavailable: 'Loyalty data could not be read right now — not "no account".',
    retry: 'Try again',
  },
  recon: {
    schemeUnreadable: "Commission (scheme unreadable)",
    schemeMissing: "Commission (no scheme yet)",
    // CA-2-08 / CA-2-09 — see the Indonesian side. Neither row is an addend.
    shippingIncluded: 'Shipping billed (already inside total sales)',
    commissionBase: 'Commission base (goods before discount)',
  },
  toggleCol: 'Grant/clear every capability for this role',
  roleDetail: 'See every capability this role holds',
  roleDetailShort: 'detail',
  toggleRow: 'Grant/clear this capability for all roles',
  surfaces: 'menus',
};
