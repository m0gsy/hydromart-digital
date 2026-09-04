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

/** `?depotId=` when there is one to send, and nothing at all when there is not. */
function withDepot(path: string, depotId?: string | null): string {
  return depotId ? `${path}?depotId=${encodeURIComponent(depotId)}` : path;
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
    batch: (ids: string[]) =>
      `/products/api/v1/products/batch?ids=${ids.map(encodeURIComponent).join(',')}`,
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

  // A2: the cart is priced BY a depot, so every route that answers with a priced cart
  // takes one. Omitting it stays valid and answers with catalog base prices, flagged
  // `pricingBasis: 'CATALOG'`. The mutation routes take it too, because they answer with
  // the whole cart — a client that only sent it on GET would watch prices flip on every
  // quantity tap.
  cart: {
    view: (depotId?: string | null) => withDepot('/orders/api/v1/cart', depotId),
    /**
     * PG-03 — the SHELF price, for the catalogue grid and the product page.
     *
     * Both printed `product.basePrice` while this same service billed the cart at the depot's
     * price: Rp20.000 on the shelf, Rp22.000 on the bill, wherever a depot ran a pricing rule.
     * This answers from the function the bill is computed by, so the two cannot disagree.
     */
    shelfPrices: (productIds: string[], depotId?: string | null) => {
      const p = new URLSearchParams({ productIds: productIds.join(',') });
      if (depotId) p.set('depotId', depotId);
      return `/orders/api/v1/cart/shelf-prices?${p.toString()}`;
    },
    items: (depotId?: string | null) => withDepot('/orders/api/v1/cart/items', depotId),
    item: (productId: string, depotId?: string | null) =>
      withDepot(`/orders/api/v1/cart/items/${productId}`, depotId),
    clear: '/orders/api/v1/cart',
  },

  orders: {
    walkIn: '/orders/api/v1/orders/walk-in',
    // C12: prices the basket without selling it. No phone field on purpose — see the route.
    walkInQuote: '/orders/api/v1/orders/walk-in/quote',
    // C12: the deliberate tap that identifies a counter buyer, and the only one that may
    // create an account.
    walkInIdentify: '/orders/api/v1/orders/walk-in/identify',
    // Undo a counter sale at the till (same day only).
    voidWalkIn: (id: string) => `/orders/api/v1/orders/walk-in/${id}/void`,
    checkout: '/orders/api/v1/orders/checkout',
    // Delivery windows + express pricing as the fulfilling depot has them configured. The
    // checkout screen carries no prices of its own: the surcharge shown here is the one the
    // order is charged.
    deliveryOptions: (depotId?: string | null) =>
      `/orders/api/v1/orders/delivery-options${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
    // CA-3-27: paged. No argument keeps the server's own default page, so the two callers
    // that only ever want "the newest few" (the home active-order card) are untouched.
    list: (q: { page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      const qs = p.toString();
      return `/orders/api/v1/orders${qs ? `?${qs}` : ''}`;
    },
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
        /** C6: counter sales only — what the till lists as its own recent sales. */
        isWalkIn?: boolean;
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
      if (q.isWalkIn !== undefined) p.set('isWalkIn', String(q.isWalkIn));
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
    // K1.9 — move a standing plan to a different saved address. Sends the whole snapshot,
    // not an address-book id: the plan keeps its own copy so an address edit cannot silently
    // re-route a standing order or change which depot prices it (D7).
    address: (id: string) => `/orders/api/v1/subscriptions/${id}/address`,
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
    // A staff read of ONE customer's referral standing (`loyaltyRead`). Built and reachable
    // from nowhere, so the depot could see its own referral rollup and never the person in
    // front of them — which is the row somebody is actually asking about.
    byCustomer: (customerId: string) =>
      `/referrals/api/v1/referrals/customers/${encodeURIComponent(customerId)}`,
    redeem: '/referrals/api/v1/referrals',
    // Depot-scoped referral rollup (design 17b): invited/qualified/conversion + top
    // referrers among the depot's own customers.
    depotSummary: (depotId: string) =>
      `/referrals/api/v1/referrals/depot-summary?depotId=${encodeURIComponent(depotId)}`,
  },

  // Points-redeem catalog (loyalty-service).
  /*
   * PAR-09. The order outbox: the retry queue for the side effects a completed order still
   * owes — the stock consume, the loyalty award, the referral qualification, the
   * franchise-owner credit. Money is owed against a PENDING row.
   *
   * The gauge exists "so a queue that stops draining is visible", and no screen showed it, so
   * it was visible to nobody. The manual drain next to it is SUPER_ADMIN-only and was equally
   * unreachable — the scheduler has its own internal door.
   */
  orderOutbox: {
    pending: '/orders/api/v1/orders/outbox/pending',
    process: '/orders/api/v1/orders/outbox/process',
  },

  rewards: {
    catalog: '/loyalty/api/v1/rewards/catalog',
    // PAR-04: the CATALOGUE MANAGEMENT trio. All three were built (design 15c) and reachable
    // from no screen, so the reward table could only be edited with SQL — which is what the
    // controller's own comment says it was there to end. `items` differs from `catalog`: it
    // returns retired rows too, because restoring one is the other half of retiring it.
    items: '/loyalty/api/v1/rewards/items',
    updateItem: (id: string) => `/loyalty/api/v1/rewards/items/${encodeURIComponent(id)}`,
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

  loyalty: {
    // depotId scopes both to that depot's membership ladder (thresholds + rates are
    // per-depot settings); omitted answers against the global one.
    tiers: (depotId?: string | null) =>
      `/loyalty/api/v1/loyalty/tiers${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
    me: (depotId?: string | null) =>
      `/loyalty/api/v1/loyalty/me${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
    // The earning rules a screen states in prose (earn rate, point expiry). Public and
    // depot-scoped: three screens used to say "1 poin per Rp 1.000" as a literal while the
    // rate itself is a per-depot setting an operator can change.
    rules: (depotId?: string | null) =>
      `/loyalty/api/v1/loyalty/rules${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
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
    /** K4.2 — who changed this agen's terms, when, and what is still scheduled. */
    priceChanges: (customerId: string) => `/customers/api/v1/resellers/${customerId}/price-changes`,
    /**
     * K4.1 — the agen's own status screen, and DISPLAY ONLY.
     *
     * A4 removed the previous caller on purpose: checkout used this to re-derive the agen
     * rule in the browser, the third copy of a pricing decision that belongs to
     * order-service. That must not come back. Showing a person their own terms is a
     * different thing: nothing on `/agen` feeds a price and no total is computed from it.
     *
     * If a checkout or cart file ever imports this again, that is the A4 defect returning.
     */
    me: '/customers/api/v1/resellers/me',
  },
} as const;
