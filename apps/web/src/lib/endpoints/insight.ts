// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

/**
 * `?a=1&b=2`, or an empty string. Exists so `churn` can be a single-expression builder —
 * see the note on it.
 */
function insightQuery(q: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const insight = {
  /*
   * Both read models are rebuilt from order-service's completed orders. Both routes are
   * SUPER_ADMIN-only, both were built as the backfill for a model that has drifted or was
   * never populated, and neither had a screen — so the only recovery for a stale
   * recommendation or forecast model was a hand-made HTTP request.
   */
  readModelRebuild: {
    forecast: '/forecast/api/v1/forecast/rebuild',
    recommendations: '/recommendations/api/v1/recommendations/rebuild',
  },

  // HQ analytics reports (order-service, HEAD_OFFICE/MANAGER/SUPER_ADMIN; customer is HQ-only).
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
    // Shipping (ongkir) billed per depot over a window (reconciliation 22a).
    shippingByDepot: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/orders/api/v1/reports/shipping-by-depot${qs ? `?${qs}` : ''}`;
    },
    refundsByDepot: (q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/orders/api/v1/reports/refunds-by-depot${qs ? `?${qs}` : ''}`;
    },
    // Opt-in reachable customer count for a broadcast audience (10d). Activity-based
    // (distinct customers with a non-cancelled order); optional per-depot scope.
    audienceReach: (depotId?: string) =>
      `/orders/api/v1/reports/audience-reach${depotId ? `?depotId=${depotId}` : ''}`,
    // Depot daily ops report (design 2d Laporan harian). date defaults to today (UTC) server-side.
    depotDaily: (depotId: string, date?: string) => {
      const p = new URLSearchParams({ depotId });
      if (date) p.set('date', date);
      return `/orders/api/v1/reports/depot-daily?${p}`;
    },
    // The same day, order by order — what the export button downloads. Same window as
    // depotDaily above, from the same service method, so file and screen cannot disagree.
    depotDailyExport: (depotId: string, date?: string) => {
      const p = new URLSearchParams({ depotId });
      if (date) p.set('date', date);
      return `/orders/api/v1/reports/depot-daily/export?${p}`;
    },
    // Depot water-meter reading. The SAME path serves the morning (openingM3) and the
    // evening (closingM3) write — one partial upsert, not two endpoints.
    meterSave: (depotId: string, date: string) => `/orders/api/v1/reports/meter/${depotId}/${date}`,
    meterDay: (depotId: string, date: string) => `/orders/api/v1/reports/meter/${depotId}/${date}`,
    // Daily variance history for the chart. Window defaults to the trailing 30 days.
    meterHistory: (depotId: string, q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      const qs = p.toString();
      return `/orders/api/v1/reports/meter/${depotId}${qs ? `?${qs}` : ''}`;
    },
    // Depot weekly ops report (design 7d Laporan mingguan). Window defaults to trailing 7 days.
    depotWeekly: (depotId: string, q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams({ depotId });
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      return `/orders/api/v1/reports/depot-weekly?${p}`;
    },
    // Cross-depot comparison (design 14d): real orders + revenue per depot over a window.
    depotCompare: (depotIds: string[], q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams({ depotIds: depotIds.join(',') });
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      return `/orders/api/v1/reports/depot-compare?${p}`;
    },
    // One depot's monthly ops review (orders/revenue/active customers). month = 'YYYY-MM'.
    depotMonthly: (depotId: string, month: string) =>
      `/orders/api/v1/reports/depot-monthly?${new URLSearchParams({ depotId, month })}`,
    // One depot's customer ratings (14b): average, star distribution, recent reviews.
    depotRatings: (depotId: string, q: { from?: string; to?: string } = {}) => {
      const p = new URLSearchParams({ depotId });
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      return `/orders/api/v1/reports/depot-ratings?${p}`;
    },
    // Per-reseller monthly achievement rollup (volume/prev/orders/last order).
    resellerRollup: (q: { depotId: string; month: string; customerIds: string[] }) =>
      `/orders/api/v1/reports/reseller-rollup?${new URLSearchParams({
        depotId: q.depotId,
        month: q.month,
        customerIds: q.customerIds.join(','),
      })}`,
  },

  // Activity-based segment sizing (21d). recency/frequency/depot are order-owned;
  // loyalty tier is NOT expressible here (loyalty-service owns it → badged in the UI).
  segments: {
    estimate: (
      q: {
        recencyDays?: number;
        lapsedDays?: number;
        newWithinDays?: number;
        minOrders?: number;
        depotId?: string;
      } = {},
    ) => {
      const p = new URLSearchParams();
      if (q.recencyDays != null) p.set('recencyDays', String(q.recencyDays));
      if (q.lapsedDays != null) p.set('lapsedDays', String(q.lapsedDays));
      if (q.newWithinDays != null) p.set('newWithinDays', String(q.newWithinDays));
      if (q.minOrders != null) p.set('minOrders', String(q.minOrders));
      if (q.depotId) p.set('depotId', q.depotId);
      const qs = p.toString();
      return `/orders/api/v1/reports/segment-estimate${qs ? `?${qs}` : ''}`;
    },
  },

  dashboard: {
    monthlyPnl: (depotId: string, month: string) =>
      `/dashboard/api/v1/dashboard/monthly-pnl?${new URLSearchParams({ depotId, month })}`,
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

  // PR-J: which model a depot's forecasts run through. A setting rather than an env var
  // precisely so this screen can exist — turning a candidate model on for one depot and off
  // again is a click by whoever is watching the numbers, not a deploy.
  forecastSettings: {
    schema: (depotId?: string | null) =>
      `/forecast/api/v1/settings/schema${depotId ? `?depotId=${encodeURIComponent(depotId)}` : ''}`,
    put: '/forecast/api/v1/settings',
    reset: '/forecast/api/v1/settings',
  },

  forecast: {
    // Single-product demand forecast (omit depotId for a global forecast).
    demand: (q: {
      productId: string;
      depotId?: string;
      historyDays?: number;
      horizonDays?: number;
    }) => {
      const p = new URLSearchParams();
      p.set('productId', q.productId);
      if (q.depotId) p.set('depotId', q.depotId);
      if (q.historyDays) p.set('historyDays', String(q.historyDays));
      if (q.horizonDays) p.set('horizonDays', String(q.horizonDays));
      return `/forecast/api/v1/forecast/demand?${p.toString()}`;
    },
    // Per-depot planning rollup: every product with demand, ranked by predicted total.
    depot: (
      depotId: string,
      q: { historyDays?: number; horizonDays?: number; limit?: number } = {},
    ) => {
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
    // eslint-disable-next-line max-len -- one line on purpose: the endpoints-table scanners read `name: (…) => '/path'` on a SINGLE line and a block-bodied builder is invisible to them, so /hq/churn had no server capability to check its rail gate against.
    churn: (q: { depotId?: string; limit?: number; days?: number } = {}) => `/forecast/api/v1/forecast/churn${insightQuery(q)}`,
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
    // A depot blasting its OWN customers (11a). Separate route, separate capability
    // (`depotCampaign`): its segment is pinned server-side to the depotId the
    // DepotScopeGuard already checked, so a depot cannot reach another depot's customers.
    createDepotCampaign: '/crm/api/v1/campaigns/depot',
    // Named audience definitions (21d). Saving is an upsert BY NAME: two rows sharing a
    // label is how two people message different lists believing they picked the same one.
    savedSegments: '/crm/api/v1/segments',
    savedSegment: (id: string) => `/crm/api/v1/segments/${id}`,
    // Campaign with its per-recipient delivery report (status/error/sentAt).
    campaign: (id: string) => `/crm/api/v1/campaigns/${id}`,
    sendCampaign: (id: string) => `/crm/api/v1/campaigns/${id}/send`,
    /**
     * OPS-04: the depot's own send. `sendCampaign` above needs `campaignWrite` (head
     * office); a depot manager holds `depotCampaign`, so the depot screen posted the draft
     * and never sent it — no error, no message, nothing.
     */
    sendDepotCampaign: (id: string) => `/crm/api/v1/campaigns/depot/${id}/send`,
  },

  // Depot CRM — depot-scoped customer directory + detail (customer-service, depotCrm cap).
  depotCrm: {
    list: (depotId: string, q?: string) => {
      const p = new URLSearchParams({ depotId });
      if (q) p.set('q', q);
      return `/customers/api/v1/customers/depot?${p}`;
    },
    detail: (id: string, depotId: string) =>
      `/customers/api/v1/customers/${id}/depot-detail?depotId=${encodeURIComponent(depotId)}`,
    // CRM lifecycle dashboard: segment counts + follow-up queue (Fase 4).
    crmDashboard: (depotId: string) =>
      `/customers/api/v1/customers/crm/dashboard?depotId=${encodeURIComponent(depotId)}`,
    import: '/customers/api/v1/customers/import',
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
    // Depot-scoped trail (design 8b, auditRead). depotId required; type = category chip
    // (OPNAME/RECEIPT/HARGA/SETORAN/STAF). Paginated → { items, ... }.
    forDepot: (depotId: string, q: { type?: string; page?: number; limit?: number } = {}) => {
      const p = new URLSearchParams({ depotId });
      if (q.type) p.set('type', q.type);
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      return `/auth/api/v1/auth/audit/depot?${p}`;
    },
  },
} as const;
