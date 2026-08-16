// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

interface ProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
}

/** Shared by the public product browse and the admin one, which differ only in path. */
function productQuery(q: ProductQuery): string {
  const p = new URLSearchParams();
  if (q.page) p.set('page', String(q.page));
  if (q.limit) p.set('limit', String(q.limit));
  if (q.search) p.set('search', q.search);
  if (q.categoryId) p.set('categoryId', q.categoryId);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const shop = {
products: {
  browse: (q: ProductQuery) => `/products/api/v1/products${productQuery(q)}`,
  // Same list including deactivated products (MANAGER / SUPER_ADMIN). The public
  // browse hides them, which left the console unable to switch one back on.
  browseAll: (q: ProductQuery) => `/products/api/v1/products/all${productQuery(q)}`,
  get: (id: string) => `/products/api/v1/products/${id}`,
  // Admin CRUD (MANAGER / SUPER_ADMIN).
  create: '/products/api/v1/products',
  update: (id: string) => `/products/api/v1/products/${id}`,
  remove: (id: string) => `/products/api/v1/products/${id}`,
  // Many active products by id, one call. Public, like the single-product read. The home
  // rails use it: recommendation-service mirrors only name/sku/unit, so a rail that wants
  // to show the product's photo has to ask the catalogue for it.
  batch: (ids: string[]) => `/products/api/v1/products/batch?ids=${ids.map(encodeURIComponent).join(',')}`,
  // Multipart product-image upload (admin); returns { url } to store as imageUrl.
  uploadImage: '/products/api/v1/products/images',
  // Public active-category list (no pagination) → Category[].
  categories: '/products/api/v1/categories',
  // Category admin (MANAGER / SUPER_ADMIN). `categoriesAll` also returns deactivated
  // ones, which the public list hides — the console needs them to switch one back on.
  categoriesAll: '/products/api/v1/categories/all',
  categoryCreate: '/products/api/v1/categories',
  category: (id: string) => `/products/api/v1/categories/${id}`,
},

cart: {
  view: '/orders/api/v1/cart',
  items: '/orders/api/v1/cart/items',
  item: (productId: string) => `/orders/api/v1/cart/items/${productId}`,
  clear: '/orders/api/v1/cart',
},

orders: {
  walkIn: '/orders/api/v1/orders/walk-in',
  // Undo a counter sale at the till (same day only).
  voidWalkIn: (id: string) => `/orders/api/v1/orders/walk-in/${id}/void`,
  checkout: '/orders/api/v1/orders/checkout',
  // Delivery windows + express pricing as the fulfilling depot has them configured. The
  // checkout screen carries no prices of its own: the surcharge shown here is the one the
  // order is charged.
  deliveryOptions: (depotId?: string | null) =>
    `/orders/api/v1/orders/delivery-options${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  list: '/orders/api/v1/orders',
  get: (id: string) => `/orders/api/v1/orders/${id}`,
  cancel: (id: string) => `/orders/api/v1/orders/${id}/cancel`,
  repeat: (id: string) => `/orders/api/v1/orders/${id}/repeat`,
  // GET → existing review (null if unrated), POST → submit (spec 7c).
  review: (id: string) => `/orders/api/v1/orders/${id}/review`,
  status: (id: string) => `/orders/api/v1/orders/${id}/status`,
  // Staff queue across all customers; depotId scopes to one depot (switcher).
  // unrouted=true is the HQ tray of orders that reached no depot at all.
  manage: (
    q: {
      page?: number;
      limit?: number;
      status?: string;
      depotId?: string;
      unrouted?: boolean;
      orderNumber?: string;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    if (q.status) p.set('status', q.status);
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.unrouted) p.set('unrouted', 'true');
    // Audit F-12: order-number substring, matched by order-service over the whole table.
    if (q.orderNumber) p.set('orderNumber', q.orderNumber);
    const qs = p.toString();
    return `/orders/api/v1/orders/manage${qs ? `?${qs}` : ''}`;
  },
  // Staff read of any order (the customer-scoped GET /orders/:id 404s for staff).
  manageGet: (id: string) => `/orders/api/v1/orders/manage/${id}`,
  // PATCH { depotId } — fills in the depot of an order that has none.
  assignDepot: (id: string) => `/orders/api/v1/orders/manage/${id}/depot`,
},

// Recurring galon subscriptions (order-service, spec 7b).
subscriptions: {
  list: '/orders/api/v1/subscriptions',
  create: '/orders/api/v1/subscriptions',
  pause: (id: string) => `/orders/api/v1/subscriptions/${id}/pause`,
  resume: (id: string) => `/orders/api/v1/subscriptions/${id}/resume`,
  cancel: (id: string) => `/orders/api/v1/subscriptions/${id}/cancel`,
  // The saving quoted on the signup panel. Per-depot like every other money rate, so
  // the note matches what the sweep actually charges at that depot; omitted = global.
  discount: (depotId?: string | null) =>
    `/orders/api/v1/subscriptions/discount${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  // HQ network aggregate (18c, HEAD_OFFICE/SUPER_ADMIN): active counts + per-plan breakdown.
  adminSummary: '/orders/api/v1/subscriptions/admin/summary',
},

promotions: {
  // Public active-banner feed (active + within date window, sorted) → Promotion[].
  list: '/vouchers/api/v1/promotions',
  // Admin authoring (marketing/head-office). Admin list includes inactive.
  manage: '/vouchers/api/v1/promotions/admin',
  create: '/vouchers/api/v1/promotions',
  // PATCH to edit, DELETE to remove.
  detail: (id: string) => `/vouchers/api/v1/promotions/${id}`,
  analytics: (id: string) => `/vouchers/api/v1/promotions/${id}/analytics`,
},

referrals: {
  me: '/referrals/api/v1/referrals/me',
  redeem: '/referrals/api/v1/referrals',
  // Depot-scoped referral rollup (design 17b): invited/qualified/conversion + top
  // referrers among the depot's own customers.
  depotSummary: (depotId: string) =>
    `/referrals/api/v1/referrals/depot-summary?depotId=${encodeURIComponent(depotId)}`,
},

// Points-redeem catalog (loyalty-service).
rewards: {
  catalog: '/loyalty/api/v1/rewards/catalog',
  redeem: '/loyalty/api/v1/rewards/redeem',
  // M14-03 lifecycle: the customer's own list + cancel, and the staff hand-over queue.
  myRedemptions: '/loyalty/api/v1/rewards/redemptions/me',
  // Depot-scoped hand-over queue; omit the id (head office) for the whole network.
  activeRedemptions: (depotId?: string) =>
    `/loyalty/api/v1/rewards/redemptions/active${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  cancelRedemption: (id: string) => `/loyalty/api/v1/rewards/redemptions/${id}/cancel`,
  markRedemptionUsed: (id: string) => `/loyalty/api/v1/rewards/redemptions/${id}/used`,
},

vouchers: {
  quote: '/vouchers/api/v1/vouchers/quote',
  // The current customer's voucher wallet (active vouchers + per-customer status).
  me: '/vouchers/api/v1/vouchers/me',
  // Grant a voucher to a customer's wallet (marketing/admin) → fires VOUCHER_GRANTED.
  grant: (id: string) => `/vouchers/api/v1/vouchers/${id}/grant`,
  // Admin CRUD (marketing/depot-manager/super-admin). Browse includes inactive.
  browse: (page = 1, limit = 50) => `/vouchers/api/v1/vouchers?page=${page}&limit=${limit}`,
  // HQ voucher governance (14b): real rupiah burned per voucher + network total.
  burnSummary: '/vouchers/api/v1/vouchers/burn-summary',
  create: '/vouchers/api/v1/vouchers',
  // PATCH to edit, DELETE to deactivate.
  detail: (id: string) => `/vouchers/api/v1/vouchers/${id}`,
},

// Depot→HQ voucher requests (14b). HQ queue + approve/reject; propose is depot-side.
voucherRequests: {
  queue: (q: { page?: number; limit?: number; status?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    if (q.status) p.set('status', q.status);
    const qs = p.toString();
    return `/vouchers/api/v1/voucher-requests${qs ? `?${qs}` : ''}`;
  },
  approve: (id: string) => `/vouchers/api/v1/voucher-requests/${id}/approve`,
  reject: (id: string) => `/vouchers/api/v1/voucher-requests/${id}/reject`,
  // (propose removed, audit F: the voucher approval queue was built read-and-decide —
  // `list`/`decide` are called, nothing in the web app ever raises a request.)
},

loyalty: {
  // depotId scopes both to that depot's membership ladder (thresholds + rates are
  // per-depot settings); omitted answers against the global one.
  tiers: (depotId?: string | null) =>
    `/loyalty/api/v1/loyalty/tiers${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  me: (depotId?: string | null) =>
    `/loyalty/api/v1/loyalty/me${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  // Read any customer's loyalty account (staff — HEAD_OFFICE/MARKETING/SUPER_ADMIN).
  byCustomer: (customerId: string) => `/loyalty/api/v1/loyalty/customers/${customerId}`,
  // Signed manual points correction (MANAGER/MARKETING/SUPER_ADMIN). The reason is
  // REQUIRED server-side — a points movement nobody can explain later is not a correction.
  adjust: '/loyalty/api/v1/loyalty/adjust',
  // Total enrolled members (HQ broadcast reach for the loyalty audience).
  memberCount: '/loyalty/api/v1/loyalty/members/count',
  // Depot-scoped loyalty rollup (design 17a): tier counts + points outstanding +
  // redeemed-this-month for the depot's own customers (favoriteDepotId).
  depotSummary: (depotId: string) =>
    `/loyalty/api/v1/loyalty/depot-summary?depotId=${encodeURIComponent(depotId)}`,
  transactions: (q: { page?: number; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    const qs = p.toString();
    return `/loyalty/api/v1/loyalty/me/transactions${qs ? `?${qs}` : ''}`;
  },
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

// Reseller ("agen") registry (customer-service). Staff-only (HQ + depot-manager).
resellers: {
  list: (q: { depotId?: string; active?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.depotId) p.set('depotId', q.depotId);
    if (q.active != null) p.set('active', String(q.active));
    const qs = p.toString();
    return `/customers/api/v1/resellers${qs ? `?${qs}` : ''}`;
  },
  create: '/customers/api/v1/resellers',
  import: '/customers/api/v1/resellers/import',
  detail: (customerId: string) => `/customers/api/v1/resellers/${customerId}`, // GET / PATCH
  /** SOP §7 — multipart upload of the agen's registration photo; returns the updated row. */
  uploadPhoto: (customerId: string) => `/customers/api/v1/resellers/${customerId}/photo`,
  // Caller's own reseller pricing status (customer-facing, checkout). 404 = not a reseller.
  me: '/customers/api/v1/resellers/me',
},
} as const;
