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
  // depot-service — open and close a cashier's shift. Exactly the roles that may sell at
  // the counter: whoever takes the money is who counts the drawer for it.
  cashierShift: ['KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
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
  // order-service — daily water-meter reading. WRITE includes STAFF_DEPOT because the
  // person who reads the dial at opening and closing is the operator on shift, not the
  // depot head; inventoryWrite deliberately excludes them, so this cannot reuse it.
  meterWrite: ['STAFF_DEPOT', 'KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
  meterRead: [
    'STAFF_DEPOT',
    'KEPALA_DEPOT',
    'MANAGER',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'HEAD_OFFICE',
    'DIREKTUR',
    'SUPER_ADMIN',
  ],
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
  // A depot blasting its OWN customers. Deliberately NOT campaignWrite: that one takes the
  // audience from the request body, so granting it to a depot role would let any depot
  // manager message every customer of every depot. This one only reaches POST
  // /campaigns/depot, whose segment is pinned to a depotId the DepotScopeGuard has already
  // checked against the caller's own depots.
  depotCampaign: ['KEPALA_DEPOT', 'MANAGER', 'MARKETING', 'SUPER_ADMIN'],
  // promo-service — the promotions shown on the customer Home page. Declared here rather
  // than as a hand-written @Roles array on the controller (which is what it was until
  // 2026-08-14, the last one left): a console that reads one list of roles and a server
  // that enforces another is a disagreement nobody sees until a screen 403s.
  //
  // READ includes KEPALA_DEPOT because the depot operator's own shell carries a Promo tab,
  // and the server refused it — the tab was a door to a denial screen. Reading which
  // promotions are live is what an operator at the counter needs; authoring stays with
  // marketing and the depot manager.
  promotionRead: ['KEPALA_DEPOT', 'MARKETING', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  promotionWrite: ['MARKETING', 'MANAGER', 'SUPER_ADMIN'],
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
  // Deleting a staff account: anonymises the identity across services and cannot be undone.
  // Deliberately NOT staffAdmin — head office holds that, and inviting somebody by mistake
  // is a click away from being fixed while deleting them is not.
  staffDelete: ['SUPER_ADMIN'],
  // depot-service — declaring a depot's day counted. The depot's own leadership closes it,
  // because they are the ones who counted the drawer.
  dailyClose: ['KEPALA_DEPOT', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // Reopening is head office only: a depot that can reopen its own books can rewrite a
  // total it already signed off.
  dailyCloseReopen: ['HEAD_OFFICE', 'SUPER_ADMIN'],
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
  // Reading that list is a wider circle than posting to it. The route is the courier's
  // inbox, so it was `@Roles(STAFF_DEPOT)` — which meant the depot operator could POST a
  // broadcast and then not see it, on the very screen they posted it from. Split rather
  // than widened: whoever may post may read, couriers keep their inbox, and nobody gains
  // the power to post by being able to read.
  depotBroadcastRead: ['STAFF_DEPOT', 'KEPALA_DEPOT', 'MANAGER', 'SUPER_ADMIN'],
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

  // --- Decisions that used to carry a hand-written role array on the controller. ---
  // They were invisible to this map, so the console showed one thing and the server
  // enforced another, and a super admin could not retune them at all. Same powers,
  // now declared here like everything else.

  // depot-service — HQ decides a depot's proposed price change.
  priceOverrideDecide: ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // depot-service — review/approve/reject a franchise application + its documents.
  franchiseApplications: ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // promo-service — HQ decides a depot's voucher request (approving mints the voucher).
  voucherRequestDecide: ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // admin-service — review, block or clear a fraud flag.
  fraudReview: ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // payment-service — START a refund. Wider than deciding one: a depot manager may
  // raise it, only finance signs it off.
  refundIssue: ['FINANCE', 'MANAGER', 'SUPER_ADMIN'],
  // payment-service — decide a refund parked above the auto-refund threshold. Kept
  // apart from refundIssue on purpose: whoever asks must not be whoever approves.
  refundQueue: ['FINANCE', 'SUPER_ADMIN'],
  // payment-service — read the settlement/reconciliation ledger.
  settlementRead: ['FINANCE', 'SUPER_ADMIN'],
  // payout-service — release a franchise owner's balance to their bank.
  hqPayout: ['FINANCE', 'SUPER_ADMIN'],
  // payout-service — courier earning rules. Was gated in the web console only; the
  // server had no matching guard at all, so this closes a real hole.
  earningRules: ['FINANCE', 'SUPER_ADMIN'],
  // Every service — write a GLOBAL-scope setting (a per-depot override needs only
  // depotAdmin). Replaces the `user.role !== 'SUPER_ADMIN'` string compare that was
  // copy-pasted into 14 settings endpoints.
  settingsGlobal: ['SUPER_ADMIN'],
  // auth-service — edit this very matrix. Guarded so that a super admin cannot be
  // removed from it (see the write service), otherwise the lock could be locked away.
  accessMatrixWrite: ['SUPER_ADMIN'],
  // auth-service — READ the staff directory. Wider than staffAdmin, which is the power
  // to change who holds which role: a manager needs the roster, not the switch.
  staffDirectory: ['HEAD_OFFICE', 'DIREKTUR', 'MANAGER', 'SUPER_ADMIN'],
  // depot-service — read one depot in full (edit forms, HQ onboarding, payment setup).
  // Wider than depotAdmin because an owner reads their own depot's record.
  // KEPALA_DEPOT reads it too (2026-08-14): the operator shell's "Depot" tab pointed at a
  // screen gated on depotAdmin, so the operator was shown a door to a denial. Reading the
  // record is not the power to create or deactivate a depot — that stays depotAdmin, and
  // the screen now gates its write controls separately.
  depotDirectory: ['KEPALA_DEPOT', 'MANAGER', 'HEAD_OFFICE', 'DIREKTUR', 'FRANCHISE_OWNER', 'SUPER_ADMIN'],
  // admin-service + a few HQ-only routes elsewhere — back-office tooling that is not a
  // depot power: feature flags, SLA policies, support tickets, scheduled reports,
  // export logs, incident register, system health, network subscriptions, audit trail.
  // One knob rather than fifteen identical hand-written role pairs.
  hqConsole: ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'],
  // admin-service — a staff member's OWN notification channel preferences. Deliberately
  // the widest capability in this map and safely so: the row is keyed by the caller's auth
  // `sub`, so holding it lets an account change nothing but what its own phone buzzes for.
  // It used to be `hqConsole`, which is why the depot consoles' notification toggles were
  // React state that reset on reload — there was no route a depot account could call.
  ownNotifPrefs: [
    'STAFF_DEPOT',
    'KEPALA_DEPOT',
    'ASSISTANT_SUPERVISOR',
    'SUPERVISOR',
    'MANAGER',
    'DIREKTUR',
    'FRANCHISE_OWNER',
    'HEAD_OFFICE',
    'FINANCE',
    'HR',
    'MARKETING',
    'SUPER_ADMIN',
  ],
  // payout-service — READ franchise payout batches. Wider than hqPayout: head office
  // watches the queue, only finance releases money out of it.
  hqPayoutRead: ['HEAD_OFFICE', 'DIREKTUR', 'FINANCE', 'SUPER_ADMIN'],
  // payout-service — run/close courier commission periods.
  commissionRuns: ['FINANCE', 'SUPER_ADMIN'],
  // PR-7 — capabilities that were role tuples hardcoded in a controller. Each one is a
  // policy decision (who may write the catalogue, who may read money reports, who sets
  // tax), which means it belongs in the matrix a SUPER_ADMIN can retune at runtime rather
  // than in a constant only a redeploy can change. The seeded values below are exactly the
  // role tuples they replace — this widens nothing on its own.
  //
  // product-service — the whole catalogue write surface (products, categories, uploads).
  //
  // HEAD_OFFICE is the one entry here that is NOT the original role tuple. It was added
  // because `/hq/catalog` is reachable by HEAD_OFFICE, DIREKTUR and SUPER_ADMIN (see
  // `isHq` in the web app) while MANAGER is deliberately kept OUT of the HQ console — so
  // the set of people who could open the catalogue form and the set who could save it
  // intersected at SUPER_ADMIN alone. A head-office user filled the form and got a 403,
  // with nothing on screen explaining why. DIREKTUR stays out on purpose: it is an
  // oversight role everywhere else in this matrix and reads without writing.
  catalogWrite: ['MANAGER', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // order-service — network-wide order reporting.
  orderReports: ['HEAD_OFFICE', 'MANAGER', 'SUPER_ADMIN'],
  // order-service — the same reports scoped to one depot, which a depot head may read.
  orderReportsDepot: ['HEAD_OFFICE', 'MANAGER', 'SUPER_ADMIN', 'KEPALA_DEPOT'],
  // order-service — audience-size reads behind the broadcast composer.
  audienceReach: ['HEAD_OFFICE', 'SUPER_ADMIN', 'MARKETING'],
  // payment-service — the depot tax rate a receipt is printed with.
  taxSettings: ['HEAD_OFFICE', 'SUPER_ADMIN', 'FINANCE'],
  // loyalty-service — hand-adjust a customer's points balance. Money-adjacent.
  loyaltyAdjust: ['MANAGER', 'MARKETING', 'SUPER_ADMIN'],
  // loyalty-service + referral-service — read the programme's own numbers.
  loyaltyRead: ['MANAGER', 'HEAD_OFFICE', 'MARKETING', 'SUPER_ADMIN'],
  // loyalty-service — create and retire the reward catalogue.
  rewardCatalog: ['MARKETING', 'SUPER_ADMIN'],
  // customer-service — the marketing customer directory (segments, exports).
  customerDirectory: ['MARKETING', 'HEAD_OFFICE', 'SUPER_ADMIN'],
  // order-service + crm-service — moving an order through fulfilment, and the depot
  // notifications that ride on it. Depot floor staff hold it; it is not a money power.
  orderFulfilment: ['KEPALA_DEPOT', 'MANAGER', 'STAFF_DEPOT', 'SUPER_ADMIN'],
  // delivery-service — SLA and courier reporting across the network.
  deliveryReports: ['HEAD_OFFICE', 'MANAGER', 'SUPER_ADMIN'],
  // depot-service — the depot operational report (one depot, its own numbers).
  depotOperationalReport: ['HEAD_OFFICE', 'MANAGER', 'KEPALA_DEPOT', 'FINANCE', 'SUPER_ADMIN'],
  // auth-service — look up ONE customer by exact phone, before an act that would re-role
  // the account behind that number. Held by everyone who can trigger such an act: voucher
  // grants (marketing), the employee form (HR + the two office roles that can open it),
  // and depot managers. Narrowing it silently re-creates the C-5 bug where the
  // confirmation dialog never reached half the people who could promote a mistyped customer.
  customerPhoneLookup: ['MARKETING', 'MANAGER', 'SUPER_ADMIN', 'HR', 'HEAD_OFFICE', 'DIREKTUR'],
  // auth-service — resolve a batch of customer ids to public profiles, for the reseller
  // console's row labels. NOT `staffAdmin`, which is narrower (no MANAGER): reusing it
  // here would have quietly taken this read away from every depot manager.
  customerNameLookup: ['HEAD_OFFICE', 'MANAGER', 'SUPER_ADMIN'],
  // admin-service — the platform switches only a platform owner should hold: API keys,
  // feature flags, retention policy, security policy, system settings, webhooks.
  // Seeded to SUPER_ADMIN alone, exactly as the eight class-level decorators were.
  platformAdmin: ['SUPER_ADMIN'],
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

/**
 * Roles the HR module may set on an existing login when an employee's jabatan changes.
 *
 * Wider than an import allowlist because a promotion up the supervision chain (Asisten
 * SPV -> SPV) is ordinary HR work, and leaving the login behind is how someone ends up
 * with a new title and their old access. Still bounded: the office roles, DIREKTUR,
 * FRANCHISE_OWNER and SUPER_ADMIN are granted by hand in the staff console, never as a
 * side effect of editing an employee file.
 */
export const HR_MANAGED_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
] as const satisfies readonly Role[];

export type HrManagedRole = (typeof HR_MANAGED_ROLES)[number];

/**
 * Every role that can be on the payroll — the whole enum except `CUSTOMER`.
 *
 * Wider than either allowlist above and deliberately so: those two bound what may be
 * ASSIGNED, this one bounds which employees may EXIST. A head-office clerk, a finance
 * officer and the super admin are all people who get paid, and the staff console can
 * invite them; refusing their employee record made every office invite fail.
 *
 * `CUSTOMER` stays out, and that exclusion is the whole point of the type — an end
 * customer is not headcount, and an employee record for one is always a mistake.
 * FRANCHISE_OWNER is in, because the type describes what is *acceptable*; whether an
 * owner gets an employee row is decided at the call site, not by a validation rule.
 */
export const EMPLOYABLE_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
] as const satisfies readonly Role[];

export type EmployableRole = (typeof EMPLOYABLE_ROLES)[number];

/**
 * SUPER_ADMIN edits to the map above, as a sparse patch: one entry per CHANGED
 * capability, holding the full replacement role list. An absent entry means "use the
 * compiled default", so an empty patch is byte-for-byte the behaviour of this file.
 *
 * That is what makes the whole feature fail safe: if the source of overrides is
 * unreachable there are simply no entries, and every guard falls back to the defaults
 * shipped in the binary rather than locking the platform out.
 */
export type CapabilityOverrides = Readonly<Record<string, readonly Role[]>>;

let overrides: CapabilityOverrides = {};

/**
 * Replace the override snapshot. Called by the platform refresher on a timer, and
 * directly by tests — this is the only way the map becomes non-default, so a test that
 * never calls it sees the compiled matrix.
 */
export function loadOverrides(next: CapabilityOverrides): void {
  overrides = next;
}

/** The current patch (for the matrix editor + the /auth/me snapshot). */
export function currentOverrides(): CapabilityOverrides {
  return overrides;
}

/**
 * Roles holding `capability` right now: the override if one exists, else the compiled
 * default. An unknown capability name resolves to nobody — a typo denies rather than
 * grants (`Capability` makes that a compile error at every call site we control).
 *
 * hasOwnProperty, not `overrides[capability] ?? …`: the patch is parsed from JSON off
 * the wire, so a key like `constructor` must not resolve through the prototype.
 */
export function rolesFor(capability: string): readonly Role[] {
  if (Object.prototype.hasOwnProperty.call(overrides, capability)) {
    return overrides[capability];
  }
  // hasOwnProperty on BOTH maps. A plain `CAPABILITIES[name] ?? []` would answer
  // `rolesFor('constructor')` with Object itself, and the `.includes()` below would
  // then throw on a function instead of denying.
  if (Object.prototype.hasOwnProperty.call(CAPABILITIES, capability)) {
    return (CAPABILITIES as Record<string, readonly Role[]>)[capability];
  }
  return [];
}

/** Every capability with the roles that hold it right now (defaults + overrides). */
export function effectiveMatrix(): Record<Capability, readonly Role[]> {
  const out = {} as Record<Capability, readonly Role[]>;
  for (const capability of Object.keys(CAPABILITIES) as Capability[]) {
    out[capability] = rolesFor(capability);
  }
  return out;
}

/** Every capability a role holds right now. SUPER_ADMIN holds all of them. */
export function capabilitiesFor(role: string | null | undefined): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(c, role));
}

/**
 * Whether a role holds a capability. SUPER_ADMIN holds every one (superuser).
 *
 * The short-circuit stays ABOVE the override lookup deliberately: even a corrupt or
 * hostile override row cannot lock the superuser out of the console that fixes it.
 */
export function can(capability: Capability, role: string | null | undefined): boolean {
  if (role === 'SUPER_ADMIN') {
    return true;
  }
  return role != null && (rolesFor(capability) as readonly string[]).includes(role);
}
