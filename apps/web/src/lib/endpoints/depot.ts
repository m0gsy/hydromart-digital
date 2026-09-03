// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

export const depot = {
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
  // The depots the SIGNED-IN account may act on — the only list a staff console's depot
  // switcher may be built from. `browse` above is the anonymous network directory: building
  // a switcher from it pre-selected somebody else's depot for every depot-scoped role.
  scope: '/depots/api/v1/depots/scope',
  // Admin listing incl. inactive depots (create/update/deactivate target these).
  manage: (q: { page?: number; limit?: number; search?: string; ownershipType?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    if (q.search) p.set('search', q.search);
    if (q.ownershipType) p.set('ownershipType', q.ownershipType);
    const qs = p.toString();
    return `/depots/api/v1/depots/manage${qs ? `?${qs}` : ''}`;
  },
  create: '/depots/api/v1/depots',
  // PATCH to update (incl. active:true to reactivate); DELETE to deactivate.
  // GET on this path returns the PUBLIC projection only — no bank details, no ownerId.
  detail: (id: string) => `/depots/api/v1/depots/${id}`,
  // Full record incl. payment + ownership. Staff/owner only.
  manageDetail: (id: string) => `/depots/api/v1/depots/manage/${id}`,
  // Where to send money for ONE depot. Any signed-in user; never anonymous.
  paymentInfo: (id: string) => `/depots/api/v1/depots/${id}/payment-info`,
  // The depot's own phone, for the help screen. Signed-in only, one depot at a time —
  // contactPhone is deliberately absent from the public projection.
  contact: (id: string) => `/depots/api/v1/depots/${id}/contact`,
  // Multipart static-QRIS image upload (depotAdmin, design 4b); returns the updated depot.
  uploadQris: (id: string) => `/depots/api/v1/depots/${id}/qris`,
  // "Tutup buku": one depot declaring one day counted. GET reads the state plus whatever
  // arrived after the close; POST closes; POST .../reopen is head office only.
  dailyClose: (depotId: string, businessDate: string) =>
    `/depots/api/v1/depots/${depotId}/daily-close?businessDate=${businessDate}`,
  closeDay: (depotId: string) => `/depots/api/v1/depots/${depotId}/daily-close`,
  reopenDay: (depotId: string) => `/depots/api/v1/depots/${depotId}/daily-close/reopen`,
},

// Depot-manager console features (depot-service, design 13a/13c/14a/14c/14d/15c/15d/16b).
// All reuse the existing `depots` gateway segment (no new segment/env) — the segment strips
// `/depots` and forwards `/api/v1/<controller>` straight to depot-service.
depotTargets: {
  // GET the target row for one month (null if unset).
  get: (q: { depotId: string; month: string }) =>
    `/depots/api/v1/depot-targets?depotId=${encodeURIComponent(q.depotId)}&month=${encodeURIComponent(q.month)}`,
  upsert: '/depots/api/v1/depot-targets', // PUT
},

// Manager-managed standing orders (depot-service). Distinct from customer self-service
// recurring orders under the `subscriptions` key above (order-service, spec 7b).
depotSubscriptions: {
  list: (q: { depotId: string; status?: string }) => {
    const p = new URLSearchParams({ depotId: q.depotId });
    if (q.status) p.set('status', q.status);
    return `/depots/api/v1/subscriptions?${p}`;
  },
  // K1.11: network aggregate of the DEPOT-created half. HQ's screen read only
  // order-service's customer-created plans and presented that as the network total.
  adminSummary: '/depots/api/v1/subscriptions/admin/summary',
  create: '/depots/api/v1/subscriptions',
  pause: (id: string) => `/depots/api/v1/subscriptions/${id}/pause`,
  resume: (id: string) => `/depots/api/v1/subscriptions/${id}/resume`,
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
  // Open a stock line for one depot (staff). A PRODUK line carries the catalog
  // productId; depot-service names it from the catalog and refuses an unknown id.
  create: (depotId: string) => `/depots/api/v1/depots/${depotId}/inventory`,
  import: (depotId: string) => `/depots/api/v1/depots/${depotId}/inventory/import`,
  adjust: (itemId: string) => `/depots/api/v1/inventory/${itemId}/adjust`,
  opname: (itemId: string) => `/depots/api/v1/inventory/${itemId}/opname`,
  // Update line meta incl. per-depot sellPrice override (PATCH; sellPrice:null clears).
  update: (itemId: string) => `/depots/api/v1/inventory/${itemId}`,
  // Append-only stock movement history for one line (opname/adjust/sale/restock).
  movements: (itemId: string) => `/depots/api/v1/inventory/${itemId}/movements`,
  // DELETE — only an empty line that never sold anything; the API refuses the rest.
  remove: (itemId: string) => `/depots/api/v1/inventory/${itemId}`,
  // The orders behind the "dipesan" column (ACTIVE holds, newest first).
  reservations: (itemId: string) => `/depots/api/v1/inventory/${itemId}/reservations`,
  depotMovements: (
    depotId: string,
    q: { type?: string; from?: string; to?: string; page?: number; limit?: number } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.type) p.set('type', q.type);
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    const qs = p.toString();
    return `/depots/api/v1/depots/${depotId}/inventory/movements${qs ? `?${qs}` : ''}`;
  },
  // Depot wastage summary from negative ADJUSTMENT movements (real lost qty per item).
  wastage: (depotId: string, q: { from?: string; to?: string } = {}) => {
    const p = new URLSearchParams({ depotId });
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    return `/depots/api/v1/inventory/wastage?${p}`;
  },
  // Per-depot resolved prices (override + winning active rule) for products.
  /**
   * `quantities` is positional against `productIds` and opts the caller into wholesale bands
   * (design 16b): pass the quantity actually being sold and the answer carries `tierPrice`,
   * an ABSOLUTE unit price that wins over `sellPrice` and the rule for that line. Omitting it
   * is what made the till show Rp380.000 for twenty galon the order then stored at Rp320.000 —
   * the band existed, the screen just never asked for it.
   */
  prices: (depotId: string, productIds: string[], quantities?: number[]) => {
    const qs = new URLSearchParams({ productIds: productIds.join(',') });
    if (quantities?.length) qs.set('quantities', quantities.join(','));
    return `/depots/api/v1/depots/${depotId}/inventory/prices?${qs.toString()}`;
  },
},

maintenance: {
  list: (depotId: string) =>
    `/depots/api/v1/maintenance-items?depotId=${encodeURIComponent(depotId)}`,
  create: '/depots/api/v1/maintenance-items',
  serviced: (id: string) => `/depots/api/v1/maintenance-items/${id}/serviced`,
},

// Depot procurement — suppliers + purchase orders (depot-service, design 7a/9d/11b).
// Own gateway segment (proxied to depot-service). depotId scopes lists; status filters POs.
procurement: {
  suppliers: {
    list: (depotId: string) =>
      `/procurement/api/v1/suppliers?depotId=${encodeURIComponent(depotId)}`,
    // "Never opened by id" was a description of the UI, not a decision about it: the list
    // shows a name and a code, and the depot's own on-time rate — the number that decides
    // whether to order from them again — was only ever in the row nobody could open.
    detail: (id: string) => `/procurement/api/v1/suppliers/${encodeURIComponent(id)}`,
    create: '/procurement/api/v1/suppliers',
  },
  purchaseOrders: {
    list: (q: { depotId: string; status?: string }) => {
      const p = new URLSearchParams({ depotId: q.depotId });
      if (q.status) p.set('status', q.status);
      return `/procurement/api/v1/purchase-orders?${p}`;
    },
    detail: (id: string) => `/procurement/api/v1/purchase-orders/${id}`,
    create: '/procurement/api/v1/purchase-orders',
    send: (id: string) => `/procurement/api/v1/purchase-orders/${id}/send`,
    receive: (id: string) => `/procurement/api/v1/purchase-orders/${id}/receive`,
  },
},

// The supervision map (F3): Depot -> Asisten SPV -> SPV -> Manager. Every multi-depot
// scope resolves from this, so all of it is `hierarchyAdmin` (SUPER_ADMIN by default).
hierarchy: {
  // Superior, direct reports, supervised depots and direct grants for one account.
  describe: (staffId: string) => `/depots/api/v1/staff-hierarchy/${staffId}`,
  // PUT { superiorId } to point an account at its superior; DELETE to unlink.
  superior: (staffId: string) => `/depots/api/v1/staff-hierarchy/${staffId}/superior`,
  // PUT/DELETE one depot granted directly, on top of the hierarchy walk.
  depotGrant: (staffId: string, depotId: string) =>
    `/depots/api/v1/staff-hierarchy/${staffId}/depots/${depotId}`,
  // PUT { assistantSupervisorId } / DELETE — the ONLY writer of a depot's assistant.
  depotAssistant: (depotId: string) =>
    `/depots/api/v1/staff-hierarchy/depots/${depotId}/assistant`,
},

// Depot-manager approval queue (depot-service, design 1c/2a-2c/10c/12a). Own gateway
// segment (proxied to depot-service). depotId scopes the list/counts; status filters.
approvals: {
  list: (q: { depotId: string; status?: string }) => {
    const p = new URLSearchParams({ depotId: q.depotId });
    if (q.status) p.set('status', q.status);
    return `/approvals/api/v1/approvals?${p}`;
  },
  detail: (id: string) => `/approvals/api/v1/approvals/${id}`,
  decide: (id: string) => `/approvals/api/v1/approvals/${id}/decide`,
  counts: (depotId: string) =>
    `/approvals/api/v1/approvals/counts?depotId=${encodeURIComponent(depotId)}`,
  // (create removed, audit F: approvals are RAISED by the services that need one — a
  // price override, a refund — over their own internal routes. The console lists, opens and
  // decides them; it has never created one.)
},
} as const;
