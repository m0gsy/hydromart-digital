// Pure role helpers. Covered by test/roles.test.ts.
//
// The dashboard-service enforces these roles server-side (HEAD_OFFICE /
// DEPOT_MANAGER / SUPER_ADMIN); this mirror is only for showing/hiding the
// staff dashboard link + gating the route client-side. Security stays server-side.

const DASHBOARD_ROLES = new Set(['HEAD_OFFICE', 'DEPOT_MANAGER', 'SUPER_ADMIN']);

/** Whether a role may view the operational dashboard. */
export function canViewDashboard(role: string | null | undefined): boolean {
  return role != null && DASHBOARD_ROLES.has(role);
}

/** Any non-customer role — used to gate the staff order queue. */
export function isStaff(role: string | null | undefined): boolean {
  return role != null && role !== '' && role !== 'CUSTOMER';
}

// Inventory roles mirror depot-service: READ (view stock) is broader than WRITE
// (adjust/opname — no HEAD_OFFICE). Security stays server-side; these only show/hide UI.
const INVENTORY_READ = new Set(['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN']);
const INVENTORY_WRITE = new Set(['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN']);

/** Whether a role may view depot stock lines. */
export function canViewInventory(role: string | null | undefined): boolean {
  return role != null && INVENTORY_READ.has(role);
}

/** Whether a role may adjust stock or record an opname count. */
export function canWriteInventory(role: string | null | undefined): boolean {
  return role != null && INVENTORY_WRITE.has(role);
}

// Campaign roles mirror crm-service: READ (view) adds HEAD_OFFICE for oversight;
// WRITE (create/send) is marketing + super-admin. Security stays server-side.
const CAMPAIGN_READ = new Set(['MARKETING', 'HEAD_OFFICE', 'SUPER_ADMIN']);
const CAMPAIGN_WRITE = new Set(['MARKETING', 'SUPER_ADMIN']);

/** Whether a role may view broadcast campaigns. */
export function canViewCampaigns(role: string | null | undefined): boolean {
  return role != null && CAMPAIGN_READ.has(role);
}

/** Whether a role may create or send a broadcast campaign. */
export function canManageCampaigns(role: string | null | undefined): boolean {
  return role != null && CAMPAIGN_WRITE.has(role);
}

// Depot admin mirrors depot-service DEPOT_ADMIN_ROLES (manager + super-admin).
const DEPOT_ADMIN = new Set(['DEPOT_MANAGER', 'SUPER_ADMIN']);

/** Whether a role may create, edit, or deactivate depots. */
export function canManageDepots(role: string | null | undefined): boolean {
  return role != null && DEPOT_ADMIN.has(role);
}

/** Whether a role may view the franchise dashboard (mirrors dashboard-service FRANCHISE_OWNER-only). */
export function canViewFranchise(role: string | null | undefined): boolean {
  return role === 'FRANCHISE_OWNER';
}

/** Whether a role may manage dynamic pricing rules (mirrors depot-service manager+super-admin). */
export function canManagePricing(role: string | null | undefined): boolean {
  return role != null && DEPOT_ADMIN.has(role);
}

// Mirrors forecast-service PLANNING_ROLES (query endpoints). Security stays server-side.
const PLANNING_ROLES = new Set([
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'HEAD_OFFICE',
  'SUPER_ADMIN',
  'FRANCHISE_OWNER',
]);

/** Whether a role may view demand forecasts. */
export function canViewForecast(role: string | null | undefined): boolean {
  return role != null && PLANNING_ROLES.has(role);
}

// Mirrors forecast-service CHURN_ROLES (churn query endpoint). Marketing-led
// re-engagement, so broader than planning: MARKETING in, depot operators out.
const CHURN_ROLES = new Set(['MARKETING', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN']);

/** Whether a role may view customer churn insights. */
export function canViewChurn(role: string | null | undefined): boolean {
  return role != null && CHURN_ROLES.has(role);
}
