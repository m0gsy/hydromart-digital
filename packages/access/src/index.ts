// The single source of truth for Hydromart RBAC capabilities.
//
// One capability -> the roles that hold it. Consumed BOTH by the Nest guards
// (`@Roles(...CAPABILITIES.x)`) and by the web console (route gating + the
// "Peran & hak akses" matrix). Because both sides read this one map, a change to
// who-can-do-what is made in exactly one place and can never drift between the
// server it enforces on and the UI it shows.
//
// The server always remains authoritative — the web copy is imported from the same
// module, so it is the same values, not a hand-mirror.

/** Account roles used for RBAC across Hydromart (mirrors PRD §26 / platform Role). */
export type Role =
  | 'CUSTOMER'
  | 'DRIVER'
  | 'DEPOT_OPERATOR'
  | 'DEPOT_MANAGER'
  | 'FRANCHISE_OWNER'
  | 'HEAD_OFFICE'
  | 'FINANCE'
  | 'MARKETING'
  | 'SUPER_ADMIN';

export const CAPABILITIES = {
  // dashboard-service — executive dashboard.
  dashboard: ['HEAD_OFFICE', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // order-service — staff order queue (cross-customer read).
  orderQueue: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'DRIVER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // depot-service — inventory: READ is broader than WRITE (no HEAD_OFFICE on write).
  inventoryRead: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  inventoryWrite: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // depot-service — retur galon + galon keluar: READ adds head-office + franchise oversight.
  returnsRead: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'FRANCHISE_OWNER', 'SUPER_ADMIN'],
  returnsWrite: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // crm-service — broadcast campaigns: READ adds HEAD_OFFICE for oversight.
  campaignRead: ['MARKETING', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  campaignWrite: ['MARKETING', 'SUPER_ADMIN'],
  // promo-service — voucher admin.
  voucherRead: ['MARKETING', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  voucherWrite: ['MARKETING', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // depot-service — depot admin (create/edit/deactivate) + dynamic pricing.
  depotAdmin: ['DEPOT_MANAGER', 'SUPER_ADMIN'],
  // dashboard-service franchise view + payout-service (FRANCHISE_OWNER-only).
  franchise: ['FRANCHISE_OWNER'],
  payout: ['FRANCHISE_OWNER'],
  // auth-service — staff & roles directory.
  staffAdmin: ['HEAD_OFFICE', 'SUPER_ADMIN'],
  // auth-service — active-driver roster for dispatch (courier assignment).
  driverRoster: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // crm-service — operational notification feed.
  opsNotif: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // delivery-service — dispatch (live tracking + courier assignment).
  tracking: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // forecast-service — planning queries.
  forecast: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN', 'FRANCHISE_OWNER'],
  // forecast-service — churn (marketing-led re-engagement).
  churn: ['MARKETING', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

/** Whether a role holds a capability. */
export function can(capability: Capability, role: string | null | undefined): boolean {
  return role != null && (CAPABILITIES[capability] as readonly string[]).includes(role);
}
