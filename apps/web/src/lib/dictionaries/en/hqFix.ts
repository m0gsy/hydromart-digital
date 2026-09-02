// Strings for the HQ design-fidelity batch (matrix bulk-toggles + rail grouping).
// Kept out of hq.ts so parallel agents don't collide on one fragment.
export const hqFix = {
  // DEFECT-01 — see the Indonesian side.
  customers: {
    historyUnavailable: 'Order history could not be read right now — this is NOT a zero.',
    loyaltyUnavailable: 'Loyalty data could not be read right now — not "no account".',
    retry: 'Try again',
  },
  // CA-2-28 / CA-2-25 — see the Indonesian side.
  audit: {
    tooLarge:
      'The audit trail is too large to export in full. Narrow the range or the filter first — a partial file is worse than none.',
  },
  reportsExport: {
    depotsIncomplete:
      'The per-depot revenue report is incomplete: some depots fell outside its source report, so the figures would be wrong. The export is held back until the source is whole.',
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
