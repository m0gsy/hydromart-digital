// Role gating for the ops console. The capability map itself lives in the shared
// `@hydromart/access` package — the SAME module the Nest guards enforce with
// (`@Roles(...CAPABILITIES.x)`). So this is not a hand-mirror of the backend: it is
// the backend's own definition, imported. Change a role once in @hydromart/access and
// the server guard, every canX() gate, and the "Peran & hak akses" matrix all move
// together. Covered by test/roles.test.ts.
import { CAPABILITIES, can, type Capability } from '@hydromart/access';

export { CAPABILITIES, can };
export type { Capability };

/** Any non-customer role — used to gate the staff surfaces broadly. Not a capability set. */
export function isStaff(role: string | null | undefined): boolean {
  return role != null && role !== '' && role !== 'CUSTOMER';
}

/**
 * HQ console gate (SUPER_ADMIN + HEAD_OFFICE only). Deliberately NOT a capability
 * in @hydromart/access — HQ reach is not a depot power, and DEPOT_MANAGER holds
 * `dashboard` but is denied HQ (design 20c). So HQ reach is its own coarse gate
 * over these two head-of-network roles.
 */
export function isHq(role: string | null | undefined): boolean {
  return role === 'HEAD_OFFICE' || role === 'SUPER_ADMIN';
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
export const canConfirmPayment = (role: string | null | undefined) => can('paymentSettle', role);
export const canVerifySettlement = (role: string | null | undefined) => can('courierSettle', role);
export const canApproveExpense = (role: string | null | undefined) => can('expenseApprove', role);
export const canBroadcastToCouriers = (role: string | null | undefined) => can('depotBroadcast', role);
// Courier earning-rule editor (design 6b). Finance config, role-gated directly (like
// commission schemes) — not part of the per-depot capability matrix.
export const canManageEarningRules = (role: string | null | undefined) =>
  role === 'FINANCE' || role === 'SUPER_ADMIN';
