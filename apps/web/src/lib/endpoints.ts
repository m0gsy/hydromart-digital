// Public path builders. The gateway strips the first segment and forwards the
// rest to the owning service, so every path is `/{segment}/api/v1/...`.

export const endpoints = {
  auth: {
    register: '/auth/api/v1/auth/register',
    verifyOtp: '/auth/api/v1/auth/otp/verify',
    resendOtp: '/auth/api/v1/auth/otp/resend',
    login: '/auth/api/v1/auth/login',
    refresh: '/auth/api/v1/auth/token/refresh',
    me: '/auth/api/v1/auth/me',
    logout: '/auth/api/v1/auth/logout',
  },
  addresses: {
    // Saved delivery addresses (customer-service, via the `customers` gateway segment).
    list: '/customers/api/v1/addresses',
    create: '/customers/api/v1/addresses',
  },
  products: {
    browse: (q: { page?: number; limit?: number; search?: string }) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.search) p.set('search', q.search);
      const qs = p.toString();
      return `/products/api/v1/products${qs ? `?${qs}` : ''}`;
    },
    get: (id: string) => `/products/api/v1/products/${id}`,
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
  dashboard: {
    executive: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/dashboard/api/v1/dashboard/executive${qs ? `?${qs}` : ''}`;
    },
  },
} as const;
