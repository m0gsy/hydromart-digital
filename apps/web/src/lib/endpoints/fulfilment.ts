// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

export const fulfilment = {
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
  /*
   * One delivery, read by staff. The only orphan of the five with no written reason — it
   * was recorded, never decided. It carries its own authorisation (`assertDepotAccess`,
   * commented "close the by-id vector"), the courier side has the same route and a screen,
   * and the dispatcher tracing one late delivery had nothing.
   */
  detail: (id: string) => `/deliveries/api/v1/deliveries/${encodeURIComponent(id)}`,
// B2: the dispatcher's two ways to take a delivery back off a courier who cannot
// finish it. Release hands the ORDER back to the queue for someone else; cancel ends
// it, which is what returns the stock the checkout is still holding.
release: (id: string) => `/deliveries/api/v1/deliveries/${id}/release`,
cancel: (id: string) => `/deliveries/api/v1/deliveries/${id}/cancel`,
  // Driver-facing: a driver only ever sees and acts on their own deliveries.
  driver: {
    list: (status?: string) => {
      const base = '/deliveries/api/v1/driver/deliveries';
      return status ? `${base}?status=${status}` : base;
    },
    get: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}`,
    // pickup/start/fail are PATCH on the service — use api.patch, not api.post.
    pickup: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/pickup`,
    start: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/start`,
    complete: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/complete`,
    fail: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/fail`,
    // No-show gate (5a): POST records a contact attempt → { attempts, eligibleAt,
    // canMarkNoShow }; PATCH no-show fails the delivery once the gate is met.
    contactAttempts: (id: string) =>
      `/deliveries/api/v1/driver/deliveries/${id}/contact-attempts`,
    noShow: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/no-show`,
    // Reschedule (3c): PATCH { rescheduledFor, slot?, note? } → RESCHEDULED.
    reschedule: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/reschedule`,
    // Position ping while ON_DELIVERY; overwrites, no history.
    location: (id: string) => `/deliveries/api/v1/driver/deliveries/${id}/location`,
    // Multipart PoD upload (photo + signature); returns { url }.
    upload: '/deliveries/api/v1/driver/deliveries/uploads',
  },
  // Dispatch view of courier shifts (cap: tracking) — who may be handed a delivery right
  // now. Always send `from`: the service filters on checkInAt with no default window, so
  // an unbounded call would scan every shift ever recorded.
  shiftsOnDuty: (from: string, depotId?: string) =>
    `/deliveries/api/v1/shifts?from=${encodeURIComponent(from)}${
      depotId ? `&depotId=${encodeURIComponent(depotId)}` : ''
    }`,
  // Courier shift (design 3a/3b). check-in/out are POST; status is PATCH.
  shifts: {
    current: '/deliveries/api/v1/driver/shifts/current',
    history: '/deliveries/api/v1/driver/shifts',
    checkIn: '/deliveries/api/v1/driver/shifts/check-in',
    checkOut: (id: string) => `/deliveries/api/v1/driver/shifts/${id}/check-out`,
    status: (id: string) => `/deliveries/api/v1/driver/shifts/${id}/status`,
  },
  // Courier field incident reporting (design 4b). POST reports; HIGH alerts ops.
  incidents: {
    list: '/deliveries/api/v1/driver/incidents',
    create: '/deliveries/api/v1/driver/incidents',
  },
  // Courier end-of-shift COD settlement (design 2d/9a). POST deposits a shift's cash;
  // the expected total is snapshotted server-side from payment-service.
  settlement: {
    history: '/deliveries/api/v1/driver/settlement',
    /*
     * There is one now. The history row shows a status and two totals; what it cannot show
     * is WHY — the note a cashier wrote when they disputed it, who verified it and when,
     * and whether the shortfall was charged to the courier. That is the courier's own money
     * and the answer they would take to a manager.
     */
    get: (id: string) => `/deliveries/api/v1/driver/settlement/${encodeURIComponent(id)}`,
    submit: '/deliveries/api/v1/driver/settlement',
  },
  // Courier empty-gallon return at handover (design 2e, depot-service). Deposit refund
  // is derived server-side (GALLON_DEPOSIT_IDR × qty) — the client never sends an amount.
  gallonReturns: {
    create: '/depots/api/v1/driver/gallon-returns',
  },
  // Courier weekly performance card (design 4c). Local delivery aggregates + rating
  // batch; pass the courier's depot to get the depot leaderboard rank.
  performance: (weekStart: string, depotId?: string) => {
    const p = new URLSearchParams({ weekStart });
    if (depotId) p.set('depotId', depotId);
    return `/deliveries/api/v1/driver/performance?${p}`;
  },
  // Depot courier commission run (design 11c, courierSettle cap). Per-courier delivered ×
  // flat rate − charged COD shortfall; window defaults to the current month server-side.
  commission: (depotId: string, q: { from?: string; to?: string } = {}) => {
    const p = new URLSearchParams({ depotId });
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    return `/deliveries/api/v1/commission?${p}`;
  },
  depotTeam: (depotId: string, q: { from?: string; to?: string } = {}) => {
    const p = new URLSearchParams({ depotId });
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    return `/deliveries/api/v1/reports/depot-team?${p}`;
  },
},

// Depot operational incidents inbox (depot-service, design 6b/13b). Its own gateway
// segment (proxied to depot-service). depotId scopes the list; status filters it.
incidents: {
  list: (q: { depotId: string; status?: string }) => {
    const p = new URLSearchParams({ depotId: q.depotId });
    if (q.status) p.set('status', q.status);
    return `/incidents/api/v1/incidents?${p}`;
  },
  detail: (id: string) => `/incidents/api/v1/incidents/${id}`,
  create: () => '/incidents/api/v1/incidents',
  resolve: (id: string) => `/incidents/api/v1/incidents/${id}/resolve`,
},

disputes: {
  list: (q: { depotId: string; status?: string }) => {
    const p = new URLSearchParams({ depotId: q.depotId });
    if (q.status) p.set('status', q.status);
    return `/depots/api/v1/order-disputes?${p}`;
  },
  create: '/depots/api/v1/order-disputes',
  resolve: (id: string) => `/depots/api/v1/order-disputes/${id}/resolve`,
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
  // (list removed, audit F: the depot screen reads `summary` for the outstanding figure and
  // posts `create` when a galon goes out. Nothing has ever paged the raw issues.)
  summary: (depotId: string) => `/depots/api/v1/depots/${depotId}/gallon-issues/summary`,
  create: (depotId: string) => `/depots/api/v1/depots/${depotId}/gallon-issues`,
},

// Network gallon rollup (HQ compare 14d + reconciliation 22a): per-depot outstanding
// empties + net deposit held (issued − returned), one grouped call.
gallonNetwork: {
  outstanding: '/depots/api/v1/gallon-outstanding',
},

// Courier shift roster (depot-service, design 6d/7b). Own gateway segment (proxied to
// depot-service). week reads a depot's grid; setCell/bulk write it (driverRoster cap).
roster: {
  week: (depotId: string, weekStart: string) =>
    `/shifts/api/v1/shifts?depotId=${encodeURIComponent(depotId)}&weekStart=${encodeURIComponent(weekStart)}`,
  setCell: () => '/shifts/api/v1/shifts',
  /*
   * There is one now: "salin minggu lalu". Filling a week one tap at a time is 7 x N
   * separate requests, each able to fail on its own and leave a half-written roster with
   * nothing to roll back to. Copying last week is the operation that needs a bulk write,
   * and the one a depot actually does — most couriers work the same pattern every week.
   */
  bulk: () => '/shifts/api/v1/shifts/bulk',
},

handover: {
  list: (depotId: string) =>
    `/depots/api/v1/shift-handovers?depotId=${encodeURIComponent(depotId)}`,
  create: '/depots/api/v1/shift-handovers',
  sign: (id: string) => `/depots/api/v1/shift-handovers/${id}/sign`,
},

huddle: {
  // (list removed, audit F: it built the SAME path as `get` below minus the week filter,
  // and `get` is the one every caller uses. Two entries, one route, one of them dead.)
  get: (q: { depotId: string; weekStart: string }) =>
    `/depots/api/v1/huddle-notes?depotId=${encodeURIComponent(q.depotId)}&weekStart=${encodeURIComponent(q.weekStart)}`,
  upsert: '/depots/api/v1/huddle-notes', // PUT
},

// Delivery-service business tunables. The one that matters to HQ is `slaMinutes`: it is
// what `onTime` is computed against — and therefore what courier commission turns on — so
// the HQ SLA screen edits THIS rather than a second threshold nothing reads.
deliverySettings: {
  schema: (depotId?: string | null) =>
    `/deliveries/api/v1/settings/schema${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
  put: '/deliveries/api/v1/settings',
},
} as const;
