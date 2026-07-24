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
  | 'HR'
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
  // payment-service — settle a payment (confirm cash/transfer/QRIS received). Mirrors
  // the settlement roles; DRIVER can confirm cash-on-delivery, FINANCE for the office.
  paymentSettle: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'DRIVER', 'FINANCE', 'SUPER_ADMIN'],
  // payout-service — a courier reads their own earnings ledger and files their own
  // expense claims. Scoped to self by the controller, never cross-courier.
  courierPayout: ['DRIVER'],
  // delivery-service — the depot cashier verifies a courier's end-of-shift COD deposit
  // and decides whether a shortfall is charged to the courier.
  courierSettle: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'FINANCE', 'SUPER_ADMIN'],
  // payout-service — decide a courier expense claim above the auto-approve threshold.
  expenseApprove: ['DEPOT_MANAGER', 'FINANCE', 'SUPER_ADMIN'],
  // crm-service — depot -> courier in-app announcements (not customer campaigns).
  depotBroadcast: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // depot-service — a courier records empties taken back at the customer's door.
  // Narrower than returnsWrite: the refund amount is derived server-side from the
  // depot's deposit rate, never supplied by the courier.
  courierReturn: ['DRIVER'],
  // crm-service — depot-scoped customer directory (CRM read: profiles, deposit
  // ledger, order history). Depot staff see their own depot's customers.
  depotCrm: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // depot-service — operational incidents inbox (courier/vehicle/complaint reports)
  // and follow-up. Operators log & triage, managers resolve.
  incidents: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  // auth-service — depot-scoped audit trail read (who did what at this depot).
  auditRead: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // procurement-service — purchase orders + supplier directory (goods-in -> RECEIPT).
  // Manager-exclusive depot power (like depotAdmin).
  procurement: ['DEPOT_MANAGER', 'SUPER_ADMIN'],
  // depot-service — the manager approval queue: opname-variance, deposit-refund and
  // COD-settlement-variance decisions that exceed the depot's auto-pass thresholds.
  approvals: ['DEPOT_MANAGER', 'SUPER_ADMIN'],
  // dashboard/order/payout roll-up — depot P&L, cashbook, payment reconciliation,
  // courier commission runs, monthly ops review. Depot manager + the office finance team.
  depotFinance: ['DEPOT_MANAGER', 'FINANCE', 'SUPER_ADMIN'],
  // depot-service — team & culture ops, split per-feature (was one `depotTeam` cap)
  // so each page can carry its own roles. Shift-floor ops (huddle/handover/maintenance)
  // include the operator who runs the daily shift; pricing/B2B & targets stay
  // manager-led. Each decoupled from the shared caps it used to borrow
  // (depotAdmin/depotCrm/dashboard) so widening one never leaks into depot CRUD,
  // the customer directory, or the exec dashboard.
  depotHuddle: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  depotHandover: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  depotMaintenance: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  depotTargets: ['HEAD_OFFICE', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
  depotWholesale: ['DEPOT_MANAGER', 'SUPER_ADMIN'],
  depotSubscriptions: ['DEPOT_MANAGER', 'SUPER_ADMIN'],
  depotDisputes: ['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // hr-service (HRIS Lite). Manage employees, face enrollment, attendance edits, and the
  // SalaryConfiguration tunables. HR desk + head office; SUPER_ADMIN always.
  hrAdmin: ['HR', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // hr-service — generate/approve/pay payroll. HR desk + the office finance team.
  hrPayroll: ['HR', 'FINANCE', 'SUPER_ADMIN'],
  // hr-service — read HR dashboards & reports. Adds finance oversight and lets a depot
  // manager see their own depot (DepotScopeGuard keeps it to their depot).
  hrView: ['HR', 'HEAD_OFFICE', 'FINANCE', 'DEPOT_MANAGER', 'SUPER_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

/** Whether a role holds a capability. SUPER_ADMIN holds every one (superuser). */
export function can(capability: Capability, role: string | null | undefined): boolean {
  if (role === 'SUPER_ADMIN') {
    return true;
  }
  return role != null && (CAPABILITIES[capability] as readonly string[]).includes(role);
}
