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
    logout: '/auth/api/v1/auth/logout',
  },
  // Notification channel preferences (GET to read, PATCH to update).
  preferences: {
    notifications: '/customers/api/v1/profile/notifications',
  },
  // Customer's notification inbox feed (crm-service, newest first).
  notifications: {
    me: '/crm/api/v1/notifications/me',
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
    // Staff queue across all customers.
    manage: (q: { page?: number; limit?: number; status?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.status) p.set('status', q.status);
      const qs = p.toString();
      return `/orders/api/v1/orders/manage${qs ? `?${qs}` : ''}`;
    },
  },
  payments: {
    initiate: '/payments/api/v1/payments',
    forOrder: (orderId: string) => `/payments/api/v1/payments?orderId=${orderId}`,
  },
  // Recurring galon subscriptions (order-service, spec 7b).
  subscriptions: {
    list: '/orders/api/v1/subscriptions',
    create: '/orders/api/v1/subscriptions',
    pause: (id: string) => `/orders/api/v1/subscriptions/${id}/pause`,
    resume: (id: string) => `/orders/api/v1/subscriptions/${id}/resume`,
    cancel: (id: string) => `/orders/api/v1/subscriptions/${id}/cancel`,
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
} as const;
