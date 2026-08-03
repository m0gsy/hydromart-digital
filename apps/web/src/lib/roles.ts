// Role gating for the ops console. The capability map itself lives in the shared
// `@hydromart/access` package — the SAME module the Nest guards enforce with
// (`@Roles(...CAPABILITIES.x)`). So this is not a hand-mirror of the backend: it is
// the backend's own definition, imported. Change a role once in @hydromart/access and
// the server guard, every canX() gate, and the "Peran & hak akses" matrix all move
// together. Covered by test/roles.test.ts.
import { CAPABILITIES, can as compiledCan, type Capability } from '@hydromart/access';

export { CAPABILITIES };
export type { Capability };

// The signed-in account's capability list as the SERVER computed it (defaults plus any
// super-admin override), delivered on the session and /auth/me. Held module-level for
// the same reason CAPABILITIES is: every canX() wrapper reads it without threading a
// context through 35 call sites.
let session: { role: string; caps: ReadonlySet<string> } | null = null;

/** Called by the auth context whenever the signed-in account changes. */
export function loadSessionCapabilities(
  role: string | null | undefined,
  capabilities: string[] | null | undefined,
): void {
  session = role && capabilities ? { role, caps: new Set(capabilities) } : null;
}

/**
 * Whether a role holds a capability.
 *
 * For the SIGNED-IN role this answers from the server's own list, so a super admin's
 * matrix edit moves the console at the same moment it moves the guards. For any OTHER
 * role — the access matrix screen asking "what can a SUPERVISOR do?" — it falls back to
 * the compiled defaults, which is the right answer to a different question.
 */
export function can(capability: Capability, role: string | null | undefined): boolean {
  if (role === 'SUPER_ADMIN') return true;
  if (session && role === session.role) return session.caps.has(capability);
  return compiledCan(capability, role);
}

/** Any non-customer role — used to gate the staff surfaces broadly. Not a capability set. */
export function isStaff(role: string | null | undefined): boolean {
  return role != null && role !== '' && role !== 'CUSTOMER';
}

/**
 * HQ console gate (SUPER_ADMIN + HEAD_OFFICE + DIREKTUR only). Deliberately NOT a
 * capability in @hydromart/access — HQ reach is not a depot power, and MANAGER holds
 * `dashboard` but is denied HQ (design 20c). So HQ reach is its own coarse gate over
 * the head-of-network roles. DIREKTUR sits above the depot chain and reads the network,
 * so it lands here rather than on a depot dashboard.
 */
export function isHq(role: string | null | undefined): boolean {
  return role === 'HEAD_OFFICE' || role === 'SUPER_ADMIN' || role === 'DIREKTUR';
}

export const canViewDashboard = (role: string | null | undefined) => can('dashboard', role);
export const canRecordWalkInSale = (role: string | null | undefined) => can('walkInSale', role);
export const canRunCashierShift = (role: string | null | undefined) => can('cashierShift', role);
// Reading the dial at opening and closing is the operator's job, so meterWrite is
// broader than walkInSale/inventoryWrite — it includes STAFF_DEPOT.
export const canRecordMeterReading = (role: string | null | undefined) => can('meterWrite', role);
export const canViewMeterReading = (role: string | null | undefined) => can('meterRead', role);
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
// Depot console additions (operator/manager surfaces).
export const canViewDepotCrm = (role: string | null | undefined) => can('depotCrm', role);
// Bulk-import into the depot's customer directory. Narrower than the read: HR sees the
// directory in its own console but never writes it.
export const canWriteDepotCrm = (role: string | null | undefined) => can('depotCrmWrite', role);
export const canViewIncidents = (role: string | null | undefined) => can('incidents', role);
export const canViewAudit = (role: string | null | undefined) => can('auditRead', role);
export const canManageProcurement = (role: string | null | undefined) => can('procurement', role);
// HRIS Lite (hr-service). hrView = read consoles/dashboards (incl. depot manager, scoped);
// hrAdmin = manage employees/config/face; hrPayroll = generate/approve/pay payroll.
export const canViewHr = (role: string | null | undefined) => can('hrView', role);
export const canManageHr = (role: string | null | undefined) => can('hrAdmin', role);
export const canRunPayroll = (role: string | null | undefined) => can('hrPayroll', role);
export const canReviewApprovals = (role: string | null | undefined) => can('approvals', role);
export const canViewDepotFinance = (role: string | null | undefined) => can('depotFinance', role);
// Role identity helpers for shell SELECTION — "which console do we render for this
// account". Kept exact on purpose: a super admin must still land on the executive
// dashboard, not the operator's top-tab console. For "may this account open the page",
// use the canUseXConsole() gates below instead.
export const isDepotOperator = (role: string | null | undefined) => role === 'KEPALA_DEPOT';
export const isDepotManager = (role: string | null | undefined) => role === 'MANAGER';
// GLOBAL-scope settings writes are SUPER_ADMIN-only server-side (settings.controller.ts);
// this mirrors that gate so the UI doesn't offer inputs the server will 403.
export const isSuperAdmin = (role: string | null | undefined) => role === 'SUPER_ADMIN';

// Console-ENTRY gates. These three consoles are role-shaped rather than capability-shaped
// — there is no `wastage` or `checkIn` capability to hang them on — so they stay role
// checks. But a super admin oversees every console and must never be locked out of one,
// which is exactly what the bare `role === 'MANAGER'` comparisons used to do (it holds
// every capability in @hydromart/access yet was refused /driver, /m/manager and 11
// /dashboard pages). Separate from the identity helpers above so shell selection is
// unaffected.
export const canUseManagerConsole = (role: string | null | undefined) =>
  isDepotManager(role) || isSuperAdmin(role);
export const canUseOperatorConsole = (role: string | null | undefined) =>
  isDepotOperator(role) || isSuperAdmin(role);
export const canUseCourierApp = (role: string | null | undefined) =>
  role === 'STAFF_DEPOT' || isSuperAdmin(role);

/**
 * Roles that clock in and out, i.e. who gets a door to the HRIS self-service PWA
 * (/hr/me — face punch, my attendance, my payslip, leave).
 *
 * The whole depot chain punches: depot staff, the depot head, and the two supervision
 * ranks above them. hr-service never gated this by role — it scopes /me endpoints to the
 * linked employee — but no console linked to /hr/me at all, so in practice nobody could
 * reach it without typing the URL. This is the entry gate, not a permission: the server
 * still answers only for a caller with an employee record of their own.
 */
export const canPunchAttendance = (role: string | null | undefined) =>
  role === 'STAFF_DEPOT' ||
  role === 'KEPALA_DEPOT' ||
  role === 'ASSISTANT_SUPERVISOR' ||
  role === 'SUPERVISOR' ||
  isSuperAdmin(role);

// Reseller registry. Now a capability pair in @hydromart/access rather than a
// hand-rolled `isHq() || isDepotManager()` — the read side widened to HR (read-only
// roster in the HR console) and only the server's own map decides that.
// Reward hand-over queue (M14-03). Same capability the loyalty-service route guards on,
// so the tab and the API can never disagree about who may stamp a reward collected.
export const canHandOverRewards = (role: string | null | undefined) => can('rewardHandover', role);
export const canViewResellers = (role: string | null | undefined) => can('resellerView', role);
export const canManageResellers = (role: string | null | undefined) => can('resellerAdmin', role);

/**
 * Which landing `/dashboard` renders for a role. One shared route serves four
 * audiences, so the selection is a pure function here (tested in roles.test.ts)
 * rather than a chain of conditionals inside the page.
 *
 * - `franchise` — owners are redirected to their own overview.
 * - `operator`  — depot operators get the daily action summary (design 1a).
 * - `manager`   — depot managers get ops KPIs + approval/stock/courier widgets.
 * - `executive` — HEAD_OFFICE/SUPER_ADMIN get latency KPIs + network top lists.
 */
export type DashboardLandingView = 'franchise' | 'operator' | 'manager' | 'executive' | 'denied';

export function dashboardLandingView(role: string | null | undefined): DashboardLandingView {
  if (canViewFranchise(role) && !canViewDashboard(role)) return 'franchise';
  if (isDepotOperator(role)) return 'operator';
  if (!canViewDashboard(role)) return 'denied';
  return isDepotManager(role) ? 'manager' : 'executive';
}

/**
 * Route prefixes that belong to a staff console rather than the shop. Two things read
 * this: <AppShell> (console routes get no shop nav/cart/footer/bottom tabs) and
 * RequireAuth (a signed-out hit lands on the staff door, not the customer one).
 *
 * A constant rather than a filesystem fact — the alternative was moving ~25 customer
 * route directories under app/(shop)/ just to escape one layout. `/resellers` is
 * deliberately ABSENT: it has no console layout of its own, so stripping the shop chrome
 * would leave it with no navigation at all.
 */
export const CONSOLE_PREFIXES = ['/hq', '/dashboard', '/hr', '/driver', '/m'] as const;

/** Boundary-aware, so `/m` claims `/m/manager` but never `/mother`. */
export function isConsolePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return CONSOLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Where a role belongs after signing in at the staff door — and where the "back home"
 * button on a denial screen points. Composed from the gates above rather than a second
 * role map, so it can't drift from them.
 */
export function consoleHome(role: string | null | undefined): string {
  if (isHq(role)) return '/hq';
  if (canUseCourierApp(role)) return '/driver';
  if (dashboardLandingView(role) !== 'denied') return '/dashboard';
  if (canViewHr(role)) return '/hr';
  // MARKETING holds no dashboard capability, so the /dashboard landing would deny it —
  // send it to the surface it actually owns.
  if (canViewCampaigns(role)) return '/dashboard/campaigns';
  return isStaff(role) ? '/dashboard' : '/products';
}
