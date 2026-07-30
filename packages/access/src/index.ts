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

/**
 * Account roles used for RBAC across Hydromart (mirrors PRD §26 / platform Role).
 *
 * The depot chain runs STAFF_DEPOT -> KEPALA_DEPOT -> ASSISTANT_SUPERVISOR ->
 * SUPERVISOR -> MANAGER -> DIREKTUR. The first two are locked to one depot; the
 * three middle ones oversee a resolved SET of depots (see @hydromart/platform
 * depot-scope); DIREKTUR and the office roles are network-wide.
 */
export type Role =
  | 'CUSTOMER'
  | 'STAFF_DEPOT'
  | 'KEPALA_DEPOT'
  | 'ASSISTANT_SUPERVISOR'
  | 'SUPERVISOR'
  | 'MANAGER'
  | 'DIREKTUR'
  | 'FRANCHISE_OWNER'
  | 'HEAD_OFFICE'
  | 'FINANCE'
  | 'HR'
  | 'MARKETING'
  | 'SUPER_ADMIN';

// ASSISTANT_SUPERVISOR and SUPERVISOR see MANY depots but hold deliberately WEAKER
// powers than MANAGER: oversight reads, no writes, no money, no approvals. Widening
// them is a runtime matrix edit, not a redeploy — these are only the seeded defaults.
export const CAPABILITIES = {
  // dashboard-service — executive dashboard.
  dashboard: [
    'HEAD_OFFICE',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
  // order-service — staff order queue (cross-customer read).
  orderQueue: [
    'KEPALA_DEPOT',
    'MANAGER',
    'STAFF_DEPOT',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
  // order-service — record a cash sale at the depot counter. Deliberately narrower than
  // orderQueue: a courier and head office never stand at the till.
  walkInSale: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  // depot-service — inventory: READ is broader than WRITE (no HEAD_OFFICE on write).
  inventoryRead: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
  inventoryWrite: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  // depot-service — retur galon + galon keluar: READ adds head-office + franchise oversight.
  returnsRead: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'FRANCHISE_OWNER',
    'SUPER_ADMIN',
  ],
  returnsWrite: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  // crm-service — broadcast campaigns: READ adds HEAD_OFFICE for oversight.
  campaignRead: ['MARKETING', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  campaignWrite: ['MARKETING', 'SUPER_ADMIN'],
  // promo-service — voucher admin.
  voucherRead: ['MARKETING', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  voucherWrite: ['MARKETING', 'MANAGER', 'SUPER_ADMIN'],
  // depot-service — depot admin (create/edit/deactivate) + dynamic pricing.
  depotAdmin: ['MANAGER', 'SUPER_ADMIN'],
  // dashboard-service franchise view + payout-service (FRANCHISE_OWNER-only).
  franchise: ['FRANCHISE_OWNER'],
  payout: ['FRANCHISE_OWNER'],
  // auth-service — staff & roles directory. NOT granted to DIREKTUR: minting accounts
  // stays with head office and the superuser.
  staffAdmin: ['HEAD_OFFICE', 'SUPER_ADMIN'],
  // depot-service — the supervision hierarchy (which depot belongs to which assistant
  // supervisor, who reports to whom, direct depot grants). Superuser only by decision:
  // this map is what every multi-depot scope resolves from.
  hierarchyAdmin: ['SUPER_ADMIN'],
  // auth-service — active-driver roster for dispatch (courier assignment).
  driverRoster: ['KEPALA_DEPOT', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // crm-service — operational notification feed.
  opsNotif: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
  // delivery-service — dispatch (live tracking + courier assignment).
  tracking: ['KEPALA_DEPOT', 'MANAGER', 'SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'SUPER_ADMIN'],
  // forecast-service — planning queries.
  forecast: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
    'FRANCHISE_OWNER',
  ],
  // forecast-service — churn (marketing-led re-engagement).
  churn: ['MARKETING', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // payment-service — settle a payment (confirm cash/transfer/QRIS received). Mirrors
  // the settlement roles; STAFF_DEPOT can confirm cash-on-delivery, FINANCE for the office.
  paymentSettle: ['KEPALA_DEPOT', 'MANAGER', 'STAFF_DEPOT', 'FINANCE', 'SUPER_ADMIN'],
  // payout-service — a courier reads their own earnings ledger and files their own
  // expense claims. Scoped to self by the controller, never cross-courier.
  courierPayout: ['STAFF_DEPOT'],
  // delivery-service — the depot cashier verifies a courier's end-of-shift COD deposit
  // and decides whether a shortfall is charged to the courier.
  courierSettle: ['KEPALA_DEPOT', 'MANAGER', 'FINANCE', 'SUPER_ADMIN'],
  // payout-service — decide a courier expense claim above the auto-approve threshold.
  expenseApprove: ['MANAGER', 'FINANCE', 'SUPER_ADMIN'],
  // crm-service — depot -> courier in-app announcements (not customer campaigns).
  depotBroadcast: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  // depot-service — a courier records empties taken back at the customer's door.
  // Narrower than returnsWrite: the refund amount is derived server-side from the
  // depot's deposit rate, never supplied by the courier.
  courierReturn: ['STAFF_DEPOT'],
  // crm-service — depot-scoped customer directory (CRM read: profiles, deposit
  // ledger, order history). Depot staff see their own depot's customers.
  // HR reads it too (read-only Pelanggan tab in the HR console) — the same directory,
  // never a second copy of customer data inside hr-service.
  depotCrm: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'HR',
    'SUPER_ADMIN',
  ],
  // Writing that directory (bulk import) stays with depot staff — HR only reads it.
  depotCrmWrite: ['KEPALA_DEPOT', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // customer-service — reseller/agen registry. Split read from write so the HR console
  // can show the roster without gaining the power to change discounts.
  resellerView: ['MANAGER', 'SUPERVISOR', 'HEAD_OFFICE', 'DIREKTUR', 'HR', 'SUPER_ADMIN'],
  resellerAdmin: ['MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // depot-service — operational incidents inbox (courier/vehicle/complaint reports)
  // and follow-up. Operators log & triage, managers resolve.
  incidents: ['KEPALA_DEPOT', 'MANAGER', 'SUPERVISOR', 'SUPER_ADMIN'],
  // auth-service — depot-scoped audit trail read (who did what at this depot).
  auditRead: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
  // procurement-service — purchase orders + supplier directory (goods-in -> RECEIPT).
  // Manager-exclusive depot power (like depotAdmin).
  procurement: ['MANAGER', 'SUPER_ADMIN'],
  // depot-service — the manager approval queue: opname-variance, deposit-refund and
  // COD-settlement-variance decisions that exceed the depot's auto-pass thresholds.
  approvals: ['MANAGER', 'SUPER_ADMIN'],
  // dashboard/order/payout roll-up — depot P&L, cashbook, payment reconciliation,
  // courier commission runs, monthly ops review. Depot manager + the office finance team.
  depotFinance: ['MANAGER', 'SUPERVISOR', 'FINANCE', 'DIREKTUR', 'SUPER_ADMIN'],
  // depot-service — team & culture ops, split per-feature (was one `depotTeam` cap)
  // so each page can carry its own roles. Shift-floor ops (huddle/handover/maintenance)
  // include the operator who runs the daily shift; pricing/B2B & targets stay
  // manager-led. Each decoupled from the shared caps it used to borrow
  // (depotAdmin/depotCrm/dashboard) so widening one never leaks into depot CRUD,
  // the customer directory, or the exec dashboard.
  depotHuddle: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  depotHandover: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  depotMaintenance: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  depotTargets: ['HEAD_OFFICE', 'MANAGER', 'SUPERVISOR', 'DIREKTUR', 'SUPER_ADMIN'],
  depotWholesale: ['MANAGER', 'SUPER_ADMIN'],
  depotSubscriptions: ['MANAGER', 'SUPER_ADMIN'],
  depotDisputes: [
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
  // hr-service (HRIS Lite). Manage employees, face enrollment, attendance edits, and the
  // SalaryConfiguration tunables. HR desk + head office; SUPER_ADMIN always.
  hrAdmin: ['HR', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // hr-service — generate/approve/pay payroll. HR desk + the office finance team.
  hrPayroll: ['HR', 'FINANCE', 'SUPER_ADMIN'],
  // hr-service — stage 1 of a leave application. The depot manager decides for their own
  // depot (DepotScopeGuard enforces that); HR holds it too so a depot without a manager is
  // not stuck, and stage 2 stays hrAdmin either way.
  leaveApprove: ['MANAGER', 'HR', 'SUPER_ADMIN'],
  // hr-service — read HR dashboards & reports. Adds finance oversight and lets a depot
  // manager see their own depot (DepotScopeGuard keeps it to their depot).
  hrView: [
    'HR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'FINANCE',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'SUPER_ADMIN',
  ],
  // loyalty-service (M14-03) — hand a redeemed reward over and close its cancellation
  // window. The operator at the counter does the handing over, so they hold it; MARKETING
  // owns the reward catalogue and can correct a mis-stamped row.
  rewardHandover: ['KEPALA_DEPOT', 'MANAGER', 'MARKETING', 'SUPER_ADMIN'],
  // auth-service (UU PDP tahap 1, item 13) — decide data-subject export/deletion
  // requests. Head office only: a depot must never be able to erase a customer, and an
  // approval here is irreversible. NOT granted to DIREKTUR for the same reason.
  pdpRequests: ['HEAD_OFFICE', 'SUPER_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

/**
 * Roles a bulk employee import may provision an account for. Deliberately excludes
 * every office and supervision role: hr-service provisions accounts server-side on
 * behalf of an HR user, so without this allowlist a CSV row would be a path to minting
 * an office/superuser/supervisor account — privilege escalation through a spreadsheet.
 * Anything above depot level is created by hand in the staff console instead.
 */
export const STAFF_IMPORT_ROLES = ['STAFF_DEPOT', 'KEPALA_DEPOT'] as const satisfies readonly Role[];

export type StaffImportRole = (typeof STAFF_IMPORT_ROLES)[number];

/** Whether a role holds a capability. SUPER_ADMIN holds every one (superuser). */
export function can(capability: Capability, role: string | null | undefined): boolean {
  if (role === 'SUPER_ADMIN') {
    return true;
  }
  return role != null && (CAPABILITIES[capability] as readonly string[]).includes(role);
}
