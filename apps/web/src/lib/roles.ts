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
