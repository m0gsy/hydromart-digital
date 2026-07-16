// Public path builders. The gateway strips the first segment and forwards the
// rest to the owning service, so every path is `/{segment}/api/v1/...`.

export const endpoints = {
  auth: {
    register: '/auth/api/v1/auth/register',
    verifyOtp: '/auth/api/v1/auth/otp/verify',
    resendOtp: '/auth/api/v1/auth/otp/resend',
    login: '/auth/api/v1/auth/login',
    google: '/auth/api/v1/auth/google',
    refresh: '/auth/api/v1/auth/token/refresh',
    me: '/auth/api/v1/auth/me',
    // PATCH: update own name/email.
    updateProfile: '/auth/api/v1/auth/me',
    // Multipart avatar-photo upload (self); returns the updated customer.
    uploadAvatar: '/auth/api/v1/auth/me/avatar',
    // Staff: resolve a phone to a customer (for voucher grant). 404 if none.
    customerLookup: (phone: string) =>
      `/auth/api/v1/auth/customers/lookup?phone=${encodeURIComponent(phone)}`,
    logout: '/auth/api/v1/auth/logout',
    // Staff & roles directory (head-office/super-admin). List is paginated → { items, ... }.
    staff: (q: { page?: number; limit?: number; role?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.role) p.set('role', q.role);
      const qs = p.toString();
      return `/auth/api/v1/auth/staff${qs ? `?${qs}` : ''}`;
    },
    inviteStaff: '/auth/api/v1/auth/staff/invite',
    // Active DRIVER roster for dispatch (courier assignment). Array of Customer.
    drivers: '/auth/api/v1/auth/drivers',
  },
  // Notification channel preferences (GET to read, PATCH to update).
  preferences: {
    notifications: '/customers/api/v1/profile/notifications',
  },
  // Customer's notification inbox feed (crm-service, newest first).
  notifications: {
    me: '/crm/api/v1/notifications/me',
    // Staff operational feed: recent ops alerts (low stock, …).
    ops: '/crm/api/v1/notifications/ops',
  },
  // Saved payment instruments (customer-service). Management-only.
  paymentMethods: {
    list: '/customers/api/v1/payment-methods',
    create: '/customers/api/v1/payment-methods',
    // PATCH to edit, DELETE to remove.
    detail: (id: string) => `/customers/api/v1/payment-methods/${id}`,
    default: (id: string) => `/customers/api/v1/payment-methods/${id}/default`,
  },
  addresses: {
    // Saved delivery addresses (customer-service, via the `customers` gateway segment).
    list: '/customers/api/v1/addresses',
    create: '/customers/api/v1/addresses',
    // PATCH to edit, DELETE to remove.
    detail: (id: string) => `/customers/api/v1/addresses/${id}`,
    primary: (id: string) => `/customers/api/v1/addresses/${id}/primary`,
  },
  products: {
    browse: (q: { page?: number; limit?: number; search?: string; categoryId?: string }) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.search) p.set('search', q.search);
      if (q.categoryId) p.set('categoryId', q.categoryId);
      const qs = p.toString();
      return `/products/api/v1/products${qs ? `?${qs}` : ''}`;
    },
    get: (id: string) => `/products/api/v1/products/${id}`,
    // Admin CRUD (DEPOT_MANAGER / SUPER_ADMIN).
    create: '/products/api/v1/products',
    update: (id: string) => `/products/api/v1/products/${id}`,
    remove: (id: string) => `/products/api/v1/products/${id}`,
    // Multipart product-image upload (admin); returns { url } to store as imageUrl.
    uploadImage: '/products/api/v1/products/images',
    // Public active-category list (no pagination) → Category[].
    categories: '/products/api/v1/categories',
  },
  cart: {
    view: '/orders/api/v1/cart',
    items: '/orders/api/v1/cart/items',
    item: (productId: string) => `/orders/api/v1/cart/items/${productId}`,
    clear: '/orders/api/v1/cart',
  },
  orders: {
    checkout: '/orders/api/v1/orders/checkout',
    list: '/orders/api/v1/orders',
    get: (id: string) => `/orders/api/v1/orders/${id}`,
    cancel: (id: string) => `/orders/api/v1/orders/${id}/cancel`,
    repeat: (id: string) => `/orders/api/v1/orders/${id}/repeat`,
    // GET → existing review (null if unrated), POST → submit (spec 7c).
    review: (id: string) => `/orders/api/v1/orders/${id}/review`,
    status: (id: string) => `/orders/api/v1/orders/${id}/status`,
    // Staff queue across all customers; depotId scopes to one depot (switcher).
    manage: (q: { page?: number; limit?: number; status?: string; depotId?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.status) p.set('status', q.status);
      if (q.depotId) p.set('depotId', q.depotId);
      const qs = p.toString();
      return `/orders/api/v1/orders/manage${qs ? `?${qs}` : ''}`;
    },
  },
  // Delivery live tracking (delivery-service). Staff read; driver app posts position.
  deliveries: {
    list: (q: { status?: string; page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/deliveries/api/v1/deliveries${qs ? `?${qs}` : ''}`;
    },
    // Assign a courier to an order (dispatch); advances the order to DRIVER_ASSIGNED.
    assign: '/deliveries/api/v1/deliveries',
    // Driver-facing: a driver only ever sees and acts on their own deliveries.
    driver: {
      list: (status?: string) => {
        const base = '/deliveries/api/v1/driver/deliveries';
        return status ? `${base}?status=${status}` : base;
      },
      pickup: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/pickup`,
      start: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/start`,
      complete: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/complete`,
      // Multipart PoD upload (photo + signature); returns { url }.
      upload: '/deliveries/api/v1/driver/deliveries/uploads',
    },
  },
  payments: {
    initiate: '/payments/api/v1/payments',
    forOrder: (orderId: string) => `/payments/api/v1/payments?orderId=${orderId}`,
    // Staff: an order's payments (for settlement) — not customer-scoped.
    forOrderStaff: (orderId: string) => `/payments/api/v1/payments/for-order/${orderId}`,
    // Staff: confirm a payment as received (cash/transfer/QRIS).
    confirm: (id: string) => `/payments/api/v1/payments/${id}/confirm`,
    // HQ settlement dashboard (6a): network unsettled payments by method (FINANCE/SUPER_ADMIN).
    unsettledByMethod: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/payments/api/v1/payments/unsettled-by-method${qs ? `?${qs}` : ''}`;
    },
  },
  // HQ cross-service audit trail (auth-service, HEAD_OFFICE/SUPER_ADMIN). Paginated → { items, ... }.
  audit: {
    list: (q: { page?: number; limit?: number; action?: string; actorId?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.action) p.set('action', q.action);
      if (q.actorId) p.set('actorId', q.actorId);
      const qs = p.toString();
      return `/auth/api/v1/auth/audit${qs ? `?${qs}` : ''}`;
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
    approve: (id: string) => `/payments/api/v1/payments/${id}/refund/approve`,
    reject: (id: string) => `/payments/api/v1/payments/${id}/refund/reject`,
  },
  // Recurring galon subscriptions (order-service, spec 7b).
  subscriptions: {
    list: '/orders/api/v1/subscriptions',
    create: '/orders/api/v1/subscriptions',
    pause: (id: string) => `/orders/api/v1/subscriptions/${id}/pause`,
    resume: (id: string) => `/orders/api/v1/subscriptions/${id}/resume`,
    cancel: (id: string) => `/orders/api/v1/subscriptions/${id}/cancel`,
    // HQ network aggregate (18c, HEAD_OFFICE/SUPER_ADMIN): active counts + per-plan breakdown.
    adminSummary: '/orders/api/v1/subscriptions/admin/summary',
  },
  // HQ analytics reports (order-service, HEAD_OFFICE/DEPOT_MANAGER/SUPER_ADMIN; customer is HQ-only).
  reports: {
    // Revenue share per product (22b). Grouped by product — order-service has no category column.
    revenueByCategory: (q: { from?: string; to?: string; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/orders/api/v1/reports/revenue-by-category${qs ? `?${qs}` : ''}`;
    },
    retentionCohort: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/orders/api/v1/reports/retention-cohort${qs ? `?${qs}` : ''}`;
    },
    customer: (customerId: string) => `/orders/api/v1/reports/customer/${customerId}`,
    // Opt-in reachable customer count for a broadcast audience (10d). Activity-based
    // (distinct customers with a non-cancelled order); optional per-depot scope.
    audienceReach: (depotId?: string) =>
      `/orders/api/v1/reports/audience-reach${depotId ? `?depotId=${depotId}` : ''}`,
  },
  // Activity-based segment sizing (21d). recency/frequency/depot are order-owned;
  // loyalty tier is NOT expressible here (loyalty-service owns it → badged in the UI).
  segments: {
    estimate: (q: { recencyDays?: number; minOrders?: number; depotId?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.recencyDays != null) p.set('recencyDays', String(q.recencyDays));
      if (q.minOrders != null) p.set('minOrders', String(q.minOrders));
      if (q.depotId) p.set('depotId', q.depotId);
      const qs = p.toString();
      return `/orders/api/v1/reports/segment-estimate${qs ? `?${qs}` : ''}`;
    },
  },
  loyalty: {
    tiers: '/loyalty/api/v1/loyalty/tiers',
    me: '/loyalty/api/v1/loyalty/me',
    transactions: (q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/loyalty/api/v1/loyalty/me/transactions${qs ? `?${qs}` : ''}`;
    },
  },
  vouchers: {
    quote: '/vouchers/api/v1/vouchers/quote',
    // The current customer's voucher wallet (active vouchers + per-customer status).
    me: '/vouchers/api/v1/vouchers/me',
    // Grant a voucher to a customer's wallet (marketing/admin) → fires VOUCHER_GRANTED.
    grant: (id: string) => `/vouchers/api/v1/vouchers/${id}/grant`,
    // Admin CRUD (marketing/depot-manager/super-admin). Browse includes inactive.
    browse: (page = 1, limit = 50) => `/vouchers/api/v1/vouchers?page=${page}&limit=${limit}`,
    create: '/vouchers/api/v1/vouchers',
    // PATCH to edit, DELETE to deactivate.
    detail: (id: string) => `/vouchers/api/v1/vouchers/${id}`,
  },
  // Points-redeem catalog (loyalty-service).
  rewards: {
    catalog: '/loyalty/api/v1/rewards/catalog',
    redeem: '/loyalty/api/v1/rewards/redeem',
  },
  promotions: {
    // Public active-banner feed (active + within date window, sorted) → Promotion[].
    list: '/vouchers/api/v1/promotions',
    // Admin authoring (marketing/head-office). Admin list includes inactive.
    manage: '/vouchers/api/v1/promotions/admin',
    create: '/vouchers/api/v1/promotions',
    // PATCH to edit, DELETE to remove.
    detail: (id: string) => `/vouchers/api/v1/promotions/${id}`,
  },
  referrals: {
    me: '/referrals/api/v1/referrals/me',
    redeem: '/referrals/api/v1/referrals',
  },
  depots: {
    // Public browse (active only), paginated → { items, ... }.
    browse: (q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/depots/api/v1/depots${qs ? `?${qs}` : ''}`;
    },
    // Public "depots near me": active depots sorted by distance → NearbyDepot[].
    nearby: (q: { lat: number; lng: number; limit?: number }) => {
      const p = new URLSearchParams();
      p.set('lat', String(q.lat));
      p.set('lng', String(q.lng));
      if (q.limit) p.set('limit', String(q.limit));
      return `/depots/api/v1/depots/nearby?${p.toString()}`;
    },
    // Admin listing incl. inactive depots (create/update/deactivate target these).
    manage: (q: { page?: number; limit?: number; search?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.search) p.set('search', q.search);
      const qs = p.toString();
      return `/depots/api/v1/depots/manage${qs ? `?${qs}` : ''}`;
    },
    create: '/depots/api/v1/depots',
    // PATCH to update (incl. active:true to reactivate); DELETE to deactivate.
    detail: (id: string) => `/depots/api/v1/depots/${id}`,
  },
  inventory: {
    // Stock lines for one depot (staff).
    lines: (depotId: string, q: { itemType?: string; lowStockOnly?: boolean } = {}) => {
      const p = new URLSearchParams();
      if (q.itemType) p.set('itemType', q.itemType);
      if (q.lowStockOnly) p.set('lowStockOnly', 'true');
      const qs = p.toString();
      return `/depots/api/v1/depots/${depotId}/inventory${qs ? `?${qs}` : ''}`;
    },
    adjust: (itemId: string) => `/depots/api/v1/inventory/${itemId}/adjust`,
    opname: (itemId: string) => `/depots/api/v1/inventory/${itemId}/opname`,
    // Update line meta incl. per-depot sellPrice override (PATCH; sellPrice:null clears).
    update: (itemId: string) => `/depots/api/v1/inventory/${itemId}`,
    // Append-only stock movement history for one line (opname/adjust/sale/restock).
    movements: (itemId: string) => `/depots/api/v1/inventory/${itemId}/movements`,
    // Per-depot resolved prices (override + winning active rule) for products.
    prices: (depotId: string, productIds: string[]) =>
      `/depots/api/v1/depots/${depotId}/inventory/prices?productIds=${encodeURIComponent(productIds.join(','))}`,
  },
  // Empty-gallon returns / deposit refunds for one depot (staff). Under depots segment.
  returns: {
    list: (depotId: string, q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/depots/api/v1/depots/${depotId}/returns${qs ? `?${qs}` : ''}`;
    },
    summary: (depotId: string) => `/depots/api/v1/depots/${depotId}/returns/summary`,
    create: (depotId: string) => `/depots/api/v1/depots/${depotId}/returns`,
  },
  // Empty-gallon ISSUES on deposit (galon keluar). Paired with returns to compute
  // outstanding-at-customer + deposit held (11c). Under the depots segment.
  gallonIssues: {
    list: (depotId: string, q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/depots/api/v1/depots/${depotId}/gallon-issues${qs ? `?${qs}` : ''}`;
    },
    summary: (depotId: string) => `/depots/api/v1/depots/${depotId}/gallon-issues/summary`,
    create: (depotId: string) => `/depots/api/v1/depots/${depotId}/gallon-issues`,
  },
  pricing: {
    // Dynamic pricing rules for one depot (staff). All under the depots segment.
    rules: (depotId: string) => `/depots/api/v1/depots/${depotId}/pricing/rules`,
    create: (depotId: string) => `/depots/api/v1/depots/${depotId}/pricing/rules`,
    // PATCH to update, DELETE to remove.
    detail: (depotId: string, id: string) =>
      `/depots/api/v1/depots/${depotId}/pricing/rules/${id}`,
  },
  crm: {
    // Broadcast campaigns (marketing/head-office). List is paginated → { items, ... }.
    campaigns: (q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/crm/api/v1/campaigns${qs ? `?${qs}` : ''}`;
    },
    createCampaign: '/crm/api/v1/campaigns',
    // Campaign with its per-recipient delivery report (status/error/sentAt).
    campaign: (id: string) => `/crm/api/v1/campaigns/${id}`,
    sendCampaign: (id: string) => `/crm/api/v1/campaigns/${id}/send`,
  },
  recommendations: {
    reorder: (limit?: number) =>
      `/recommendations/api/v1/recommendations/reorder${limit ? `?limit=${limit}` : ''}`,
    related: (productId: string, limit?: number) =>
      `/recommendations/api/v1/recommendations/products/${productId}/related${limit ? `?limit=${limit}` : ''}`,
    trending: (q: { depotId?: string; days?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.days) p.set('days', String(q.days));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/recommendations/api/v1/recommendations/trending${qs ? `?${qs}` : ''}`;
    },
  },
  forecast: {
    // Single-product demand forecast (omit depotId for a global forecast).
    demand: (q: { productId: string; depotId?: string; historyDays?: number; horizonDays?: number }) => {
      const p = new URLSearchParams();
      p.set('productId', q.productId);
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.historyDays) p.set('historyDays', String(q.historyDays));
      if (q.horizonDays) p.set('horizonDays', String(q.horizonDays));
      return `/forecast/api/v1/forecast/demand?${p.toString()}`;
    },
    // Per-depot planning rollup: every product with demand, ranked by predicted total.
    depot: (depotId: string, q: { historyDays?: number; horizonDays?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.historyDays) p.set('historyDays', String(q.historyDays));
      if (q.horizonDays) p.set('horizonDays', String(q.horizonDays));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/forecast/api/v1/forecast/depot/${depotId}${qs ? `?${qs}` : ''}`;
    },
    // Revenue forecast for one depot (omit depotId for the global sum).
    sales: (q: { depotId?: string; historyDays?: number; horizonDays?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.historyDays) p.set('historyDays', String(q.historyDays));
      if (q.horizonDays) p.set('horizonDays', String(q.horizonDays));
      const qs = p.toString();
      return `/forecast/api/v1/forecast/sales${qs ? `?${qs}` : ''}`;
    },
    // At-risk customers ranked by churn score (depot-scoped when depotId set).
    churn: (q: { depotId?: string; limit?: number; days?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.limit) p.set('limit', String(q.limit));
      if (q.days) p.set('days', String(q.days));
      const qs = p.toString();
      return `/forecast/api/v1/forecast/churn${qs ? `?${qs}` : ''}`;
    },
  },
  // HQ franchise-application approvals queue (depot-service, HEAD_OFFICE/SUPER_ADMIN).
  franchiseApps: {
    list: (q: { page?: number; limit?: number; stage?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.stage) p.set('stage', q.stage);
      const qs = p.toString();
      return `/depots/api/v1/franchise-applications${qs ? `?${qs}` : ''}`;
    },
    detail: (id: string) => `/depots/api/v1/franchise-applications/${id}`,
    // PATCH stage/checklist.
    approve: (id: string) => `/depots/api/v1/franchise-applications/${id}/approve`,
    reject: (id: string) => `/depots/api/v1/franchise-applications/${id}/reject`,
  },
  // HQ commission-scheme config (payout-service, FINANCE/SUPER_ADMIN).
  commission: {
    schemes: '/payout/api/v1/commission/schemes',
    apply: '/payout/api/v1/commission/schemes/apply',
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
    propose: (depotId: string) => `/depots/api/v1/depots/${depotId}/price-overrides`,
  },
  dashboard: {
    executive: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/dashboard/api/v1/dashboard/executive${qs ? `?${qs}` : ''}`;
    },
    franchise: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/dashboard/api/v1/dashboard/franchise${qs ? `?${qs}` : ''}`;
    },
  },
  // HQ console. The network overview reuses the real executive dashboard endpoint;
  // the per-depot roll-up (revenue + real SLA + low stock for every depot) is served
  // by dashboard-service GET /dashboard/network. Global search assembles client-side
  // from the existing per-service list endpoints (depots.manage / auth.staff /
  // orders.manage); a dedicated /search endpoint is a later milestone.
  hq: {
    overview: (q: { from?: string; to?: string } = {}) => endpoints.dashboard.executive(q),
    rollup: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/dashboard/api/v1/dashboard/network${qs ? `?${qs}` : ''}`;
    },
  },
} as const;
