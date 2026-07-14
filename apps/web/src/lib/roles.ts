// Single frontend source of truth for who-can-do-what in the ops console.
//
// Each capability's role list mirrors the owning service's @Roles guard (the server
// stays authoritative — this only shows/hides UI). Everything downstream — the
// canX() route-gating helpers AND the "Peran & hak akses" matrix on the staff page —
// derives from CAPABILITIES, so a permission only ever needs editing in ONE place and
// the matrix can never drift from what the app actually gates. Covered by test/roles.test.ts.
//
// NOTE: this map is still a hand-mirror of the backend @Roles decorators. The only way
// to make a *backend* change propagate here automatically is a shared capabilities
// package consumed by the Nest guards too — a deliberate cross-service refactor tracked
// separately. Until then: change a role in the backend guard AND here together.
export const CAPABILITIES = {
  // dashboard-service (executive dashboard).
  dashboard: ['HEAD_OFFICE', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // order-service staff queue (STAFF_READ_ROLES).
  orderQueue: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'DRIVER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // depot-service inventory: READ is broader than WRITE (no HEAD_OFFICE on write).
  inventoryRead: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  inventoryWrite: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // depot-service retur galon: READ adds head-office + franchise oversight; WRITE = inventory write.
  returnsRead: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'FRANCHISE_OWNER', 'SUPER_ADMIN'],
  returnsWrite: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // crm-service campaigns: READ adds HEAD_OFFICE; WRITE = marketing + super-admin.
  campaignRead: ['MARKETING', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  campaignWrite: ['MARKETING', 'SUPER_ADMIN'],
  // promo-service vouchers.
  voucherRead: ['MARKETING', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  voucherWrite: ['MARKETING', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // depot-service depot admin (create/edit/deactivate) + dynamic pricing.
  depotAdmin: ['DEPOT_MANAGER', 'SUPER_ADMIN'],
  // dashboard-service franchise view + payout-service (FRANCHISE_OWNER-only).
  franchise: ['FRANCHISE_OWNER'],
  payout: ['FRANCHISE_OWNER'],
  // auth-service staff & roles directory.
  staffAdmin: ['HEAD_OFFICE', 'SUPER_ADMIN'],
  // crm-service ops notification feed.
  opsNotif: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // delivery-service dispatch (live tracking + courier assignment).
  tracking: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // forecast-service planning queries.
  forecast: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN', 'FRANCHISE_OWNER'],
  // forecast-service churn (marketing-led re-engagement).
  churn: ['MARKETING', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
} as const satisfies Record<string, readonly string[]>;

export type Capability = keyof typeof CAPABILITIES;

/** Whether a role holds a capability. The one predicate every canX() helper uses. */
export function can(capability: Capability, role: string | null | undefined): boolean {
  return role != null && (CAPABILITIES[capability] as readonly string[]).includes(role);
}

/** Any non-customer role — used to gate the staff surfaces broadly. Not a capability set. */
export function isStaff(role: string | null | undefined): boolean {
  return role != null && role !== '' && role !== 'CUSTOMER';
}

export const canViewDashboard = (role: string | null | undefined) => can('dashboard', role);
export const canViewInventory = (role: string | null | undefined) => can('inventoryRead', role);
export const canWriteInventory = (role: string | null | undefined) => can('inventoryWrite', role);
export const canViewReturns = (role: string | null | undefined) => can('returnsRead', role);
export const canWriteReturns = (role: string | null | undefined) => can('returnsWrite', role);
export const canViewCampaigns = (role: string | null | undefined) => can('campaignRead', role);
export const canManageCampaigns = (role: string | null | undefined) => can('campaignWrite', role);
export const canViewVouchers = (role: string | null | undefined) => can('voucherRead', role);
export const canManageVouchers = (role: string | null | undefined) => can('voucherWrite', role);
export const canManageDepots = (role: string | null | undefined) => can('depotAdmin', role);
export const canManagePricing = (role: string | null | undefined) => can('depotAdmin', role);
export const canViewFranchise = (role: string | null | undefined) => can('franchise', role);
export const canViewPayout = (role: string | null | undefined) => can('payout', role);
export const canManageStaff = (role: string | null | undefined) => can('staffAdmin', role);
export const canViewOpsNotifications = (role: string | null | undefined) => can('opsNotif', role);
export const canViewTracking = (role: string | null | undefined) => can('tracking', role);
export const canViewForecast = (role: string | null | undefined) => can('forecast', role);
export const canViewChurn = (role: string | null | undefined) => can('churn', role);
