// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

export const money = {
  payments: {
    initiateStaff: '/payments/api/v1/payments/staff',
    initiate: '/payments/api/v1/payments',
    // O5: which methods this deployment can actually take. Public — the answer belongs to
    // the platform's configuration, and checkout asks before there is an order.
    methods: '/payments/api/v1/payments/methods',
    forOrder: (orderId: string) => `/payments/api/v1/payments?orderId=${orderId}`,
    // Staff: an order's payments (for settlement) — not customer-scoped.
    forOrderStaff: (orderId: string) => `/payments/api/v1/payments/for-order/${orderId}`,
    // Depot reconciliation: POST { orderIds } → the payment recorded against each, for a
    // page of the depot's own orders. A POST because the id set is the body, and per-order
    // because a payment carries a depot only when it was rung up at the counter.
    forOrders: '/payments/api/v1/payments/for-orders',
    // Staff: confirm a payment as received (cash/transfer/QRIS).
    confirm: (id: string) => `/payments/api/v1/payments/${id}/confirm`,
    /*
     * CA-2-45: say a PENDING payment did NOT arrive (`paymentSettle`, same as confirm).
     *
     * The route shipped with settlement and nothing ever called it, so the only thing staff
     * could say about a pending payment was that it had landed. A transfer that never came
     * sat PENDING for ever, holding stock and sitting in the settlement queue as work still
     * to do. FAILED is not terminal — `needsPayment` lets the customer pay again.
     */
    fail: (id: string) => `/payments/api/v1/payments/${id}/fail`,
    /*
     * CA-2-24: RAISE a refund on a settled payment (`refundIssue` — FINANCE + MANAGER).
     *
     * The route has always existed and nothing in the console called it. The RBAC matrix
     * advertised the power to every manager who read it, and the only refunds that could
     * actually be started were the ones a customer's own cancellation started for them —
     * a wrong charge, a short delivery, a duplicate QRIS scan had no path at all. Above the
     * HQ threshold this parks in `refunds.queue` for finance rather than moving money.
     */
    refund: (id: string) => `/payments/api/v1/payments/${id}/refund`,
    // K2.1b: the payer attaches their transfer/QRIS receipt to their own payment.
    // Multipart, one call: upload and attach together, because the customer is online.
    proof: (id: string) => `/payments/api/v1/payments/${id}/proof`,
    // HQ settlement dashboard (6a): network unsettled payments by method (FINANCE/SUPER_ADMIN).
    unsettledByMethod: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/payments/api/v1/payments/unsettled-by-method${qs ? `?${qs}` : ''}`;
    },
    // HQ report export (10a): network collected (PAID) revenue by method (FINANCE/SUPER_ADMIN).
    revenueByMethod: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/payments/api/v1/payments/revenue-by-method${qs ? `?${qs}` : ''}`;
    },
  },

  // HQ tax & invoice settings (payment-service, FINANCE/SUPER_ADMIN). GET current, PUT to save.
  tax: {
    get: '/payments/api/v1/tax-settings',
    update: '/payments/api/v1/tax-settings',
  },

  // HQ refund-approval queue (payment-service, FINANCE/SUPER_ADMIN). Above the HQ threshold.
  refunds: {
    queue: (q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/payments/api/v1/payments/refunds/queue${qs ? `?${qs}` : ''}`;
    },
    // The HQ-approval threshold the queue's own subtitle states. REFUND_HQ_THRESHOLD is an
    // env var: an operator can raise it, and the sentence must move with it.
    rules: '/payments/api/v1/payments/refunds/rules',
    approve: (id: string) => `/payments/api/v1/payments/${id}/refund/approve`,
    reject: (id: string) => `/payments/api/v1/payments/${id}/refund/reject`,
  },

  // Franchise payout: commission ledger, balance & withdrawals (FRANCHISE_OWNER).
  payout: {
    summary: '/payout/api/v1/payout/summary',
    ledger: (q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/payout/api/v1/payout/ledger${qs ? `?${qs}` : ''}`;
    },
    withdrawals: '/payout/api/v1/payout/withdrawals',
    // HQ payout-release queue (6a, FINANCE/SUPER_ADMIN): pending owners + release action.
    hqQueue: '/payout/api/v1/payout/hq/pending',
    release: '/payout/api/v1/payout/hq/release',
    // One owner's available balance (HEAD_OFFICE/FINANCE/SUPER_ADMIN) — depot-detail card.
    hqOwnerBalance: (ownerId: string) => `/payout/api/v1/payout/hq/owner/${ownerId}`,
    /*
     * The way out of PROCESSING. `WithdrawalStatus` has carried PAID and FAILED since the
     * first migration and nothing ever wrote either, so a released payout sat PROCESSING
     * forever while its debit had already left the balance. Reading the queue is
     * `hqPayoutRead`; answering it is `hqPayout` (FINANCE/SUPER_ADMIN).
     */
    hqProcessing: '/payout/api/v1/payout/hq/withdrawals/processing',
    hqCourierProcessing: '/payout/api/v1/payout/hq/courier-withdrawals/processing',
    hqMarkPaid: (id: string) => `/payout/api/v1/payout/hq/withdrawals/${id}/paid`,
    hqMarkFailed: (id: string) => `/payout/api/v1/payout/hq/withdrawals/${id}/failed`,
    hqCourierMarkPaid: (id: string) => `/payout/api/v1/payout/hq/courier-withdrawals/${id}/paid`,
    hqCourierMarkFailed: (id: string) =>
      `/payout/api/v1/payout/hq/courier-withdrawals/${id}/failed`,
  },

  // Courier earnings: balance, month earnings, ledger (payout-service, STAFF_DEPOT). Design 2c.
  courierPayout: {
    summary: '/payout/api/v1/courier/earnings/summary',
    /*
     * Back, with the screen that note asked for: /driver/earnings/history.
     *
     * It said "a PAGED full history is a screen nobody has built — when one is built, add the
     * entry back with it". Nobody built it, so a courier saw the last few movements off
     * `summary.recentEntries` and had no way at all to see last month. That is money they
     * were paid.
     */
    // One expression, deliberately. A block-bodied builder is invisible to
    // check-endpoint-contracts' name map — it reads `name: (…) => '/path…'` — so the call
    // site becomes one more of the 305 whose HTTP verb nothing verifies. Both parameters are
    // always sent, so there is no conditional query string to build.
    // eslint-disable-next-line max-len -- one line on purpose: check-endpoint-contracts' name
    // map reads `name: (…) => '/path'` on a SINGLE line, and a wrapped builder becomes one
    // more of the call sites whose HTTP verb nothing verifies.
    ledger: (page: number, limit: number) =>
      `/payout/api/v1/courier/ledger?page=${page}&limit=${limit}`,
    // Effective earning rule for the calling courier's depot: monthly target + incentive tiers.
    earningRule: '/payout/api/v1/courier/earning-rule',
    withdraw: '/payout/api/v1/courier/withdrawals',
    // (withdrawals removed, audit F: the SAME path as `withdraw` above, differing only in the
    // verb the caller happens to use — and the screen reads `recentWithdrawals` off `summary`.)
    expenses: '/payout/api/v1/courier/expenses',
  },

  // Courier earning-rule editor (payout-service, design 6b; FINANCE/SUPER_ADMIN). GET lists
  // every rule, POST applies a new effective-dated one.
  earningRules: {
    list: '/payout/api/v1/courier-earning-rules',
    apply: '/payout/api/v1/courier-earning-rules',
    // Only a rule whose effective date has not arrived; the server answers 409 for any other,
    // because a rule that has been in force has priced real deliveries.
    remove: (id: string) => `/payout/api/v1/courier-earning-rules/${id}`,
  },

  // Courier expense-claim approvals (payout-service, design 6a; expenseApprove cap).
  expenseApprovals: {
    list: (q: { depotId?: string; status?: string; page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.status) p.set('status', q.status);
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/payout/api/v1/expenses${qs ? `?${qs}` : ''}`;
    },
    approve: (id: string) => `/payout/api/v1/expenses/${id}/approve`,
    reject: (id: string) => `/payout/api/v1/expenses/${id}/reject`,
  },

  // Courier COD settlement verification (delivery-service, design 2d/6a; courierSettle cap).
  settlements: {
    list: (q: { depotId: string; status?: string }) => {
      const p = new URLSearchParams({ depotId: q.depotId });
      if (q.status) p.set('status', q.status);
      return `/deliveries/api/v1/settlements?${p}`;
    },
    // The surplus-note threshold the cashier's note states. Read rather than restated: the
    // rule that refuses the deposit and the sentence describing it are one number.
    rules: '/deliveries/api/v1/settlements/rules',
    verify: (id: string) => `/deliveries/api/v1/settlements/${id}/verify`,
    dispute: (id: string) => `/deliveries/api/v1/settlements/${id}/dispute`,
  },

  // HQ price-override approvals (depot-service, 7a). List/decide are HEAD_OFFICE/SUPER_ADMIN;
  // propose is depot-manager (under the depots segment).
  priceOverrides: {
    queue: (q: { page?: number; limit?: number; status?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.status) p.set('status', q.status);
      const qs = p.toString();
      return `/depots/api/v1/price-overrides${qs ? `?${qs}` : ''}`;
    },
    approve: (id: string) => `/depots/api/v1/price-overrides/${id}/approve`,
    reject: (id: string) => `/depots/api/v1/price-overrides/${id}/reject`,
    // (propose removed, audit F: same read-and-decide shape as the voucher queue above.
    // `import` is how overrides actually reach a depot.)
    import: (depotId: string) => `/depots/api/v1/depots/${depotId}/price-overrides/import`,
    // Per-product pending-override counts for the 7a base list.
    countByProduct: '/depots/api/v1/price-overrides/count-by-product',
  },

  // HQ commission-scheme config (payout-service, FINANCE/SUPER_ADMIN).
  commission: {
    schemes: '/payout/api/v1/commission/schemes',
    apply: '/payout/api/v1/commission/schemes/apply',
  },

  cashbook: {
    list: (q: { depotId: string; from?: string; to?: string }) => {
      const p = new URLSearchParams({ depotId: q.depotId });
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      return `/depots/api/v1/cashbook?${p}`;
    },
    create: '/depots/api/v1/cashbook',
    // CA-2-22: a correction POSTS the opposite leg — it does not edit the original. A ledger
    // you can edit is a ledger nobody can audit.
    reverse: (id: string) => `/depots/api/v1/cashbook/${id}/reverse`,
  },

  // Counter chain of custody: who is on the till and what their drawer settled at.
  cashierShifts: {
    open: '/depots/api/v1/cashier-shifts',
    current: (depotId: string) =>
      `/depots/api/v1/cashier-shifts/current?depotId=${encodeURIComponent(depotId)}`,
    // (list removed, audit F: the till screens open a shift, read `current` and close it.
    // A shift HISTORY has no screen — `/dashboard/settlements` reconciles deliveries, not
    // drawers.)
    close: (id: string) => `/depots/api/v1/cashier-shifts/${id}/close`,
  },

  wholesale: {
    list: (depotId: string) =>
      `/depots/api/v1/wholesale-tiers?depotId=${encodeURIComponent(depotId)}`,
    create: '/depots/api/v1/wholesale-tiers',
    detail: (id: string) => `/depots/api/v1/wholesale-tiers/${id}`, // PATCH / DELETE
  },

  pricing: {
    // Dynamic pricing rules for one depot (staff). All under the depots segment.
    rules: (depotId: string) => `/depots/api/v1/depots/${depotId}/pricing/rules`,
    create: (depotId: string) => `/depots/api/v1/depots/${depotId}/pricing/rules`,
    // PATCH to update, DELETE to remove.
    detail: (depotId: string, id: string) => `/depots/api/v1/depots/${depotId}/pricing/rules/${id}`,
  },
} as const;
