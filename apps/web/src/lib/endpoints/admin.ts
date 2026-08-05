// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

import { insight } from './insight';

export const admin = {
// Platform administration (admin-service). Feature flags (8b), system settings (8b),
// and the aggregate per-service health roll-up (13b). SUPER_ADMIN / HEAD_OFFICE gated.
admin: {
  flags: '/admin/api/v1/feature-flags',
  // PATCH a single flag's state / rolloutPct by key.
  flag: (key: string) => `/admin/api/v1/feature-flags/${encodeURIComponent(key)}`,
  // GET current settings, PUT to replace.
  settings: '/admin/api/v1/system-settings',
  // GET aggregate per-service health (real per-service probe).
  health: '/admin/api/v1/system-health',
  // API keys (13d) — SUPER_ADMIN. Create/rotate return the full secret ONCE.
  apiKeys: {
    list: '/admin/api/v1/api-keys',
    create: '/admin/api/v1/api-keys',
    rotate: (id: string) => `/admin/api/v1/api-keys/${encodeURIComponent(id)}/rotate`,
    revoke: (id: string) => `/admin/api/v1/api-keys/${encodeURIComponent(id)}`,
  },
  // Webhook endpoints (19c) — SUPER_ADMIN.
  webhooks: {
    list: '/admin/api/v1/webhooks',
    create: '/admin/api/v1/webhooks',
    update: (id: string) => `/admin/api/v1/webhooks/${encodeURIComponent(id)}`,
    remove: (id: string) => `/admin/api/v1/webhooks/${encodeURIComponent(id)}`,
  },
  // Data-export logs (13c) — HEAD_OFFICE + SUPER_ADMIN read (paginated, filterable).
  exportLogs: (q: { page?: number; limit?: number; dataset?: string; status?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    if (q.dataset) p.set('dataset', q.dataset);
    if (q.status) p.set('status', q.status);
    const qs = p.toString();
    return `/admin/api/v1/export-logs${qs ? `?${qs}` : ''}`;
  },
  // Scheduled reports (15c) — HEAD_OFFICE + SUPER_ADMIN.
  scheduledReports: {
    list: '/admin/api/v1/scheduled-reports',
    create: '/admin/api/v1/scheduled-reports',
    update: (id: string) => `/admin/api/v1/scheduled-reports/${encodeURIComponent(id)}`,
    remove: (id: string) => `/admin/api/v1/scheduled-reports/${encodeURIComponent(id)}`,
  },
  // Support tickets (15a) — HEAD_OFFICE + SUPER_ADMIN. List with message threads; reply /
  // assign / resolve mutate a ticket.
  tickets: {
    list: (q: { status?: string; priority?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.priority) p.set('priority', q.priority);
      const qs = p.toString();
      return `/admin/api/v1/tickets${qs ? `?${qs}` : ''}`;
    },
    get: (id: string) => `/admin/api/v1/tickets/${encodeURIComponent(id)}`,
    reply: (id: string) => `/admin/api/v1/tickets/${encodeURIComponent(id)}/reply`,
    assign: (id: string) => `/admin/api/v1/tickets/${encodeURIComponent(id)}/assign`,
    resolve: (id: string) => `/admin/api/v1/tickets/${encodeURIComponent(id)}/resolve`,
  },
  // Fraud & risk flags (15b) — HEAD_OFFICE + SUPER_ADMIN read; review / block / clear.
  fraud: {
    list: (q: { level?: string; status?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.level) p.set('level', q.level);
      if (q.status) p.set('status', q.status);
      const qs = p.toString();
      return `/admin/api/v1/fraud-flags${qs ? `?${qs}` : ''}`;
    },
    review: (id: string) => `/admin/api/v1/fraud-flags/${encodeURIComponent(id)}/review`,
    block: (id: string) => `/admin/api/v1/fraud-flags/${encodeURIComponent(id)}/block`,
    clear: (id: string) => `/admin/api/v1/fraud-flags/${encodeURIComponent(id)}/clear`,
  },
  // Incident timeline (14c) — HEAD_OFFICE + SUPER_ADMIN. List/create/patch.
  incidents: {
    list: (q: { status?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      const qs = p.toString();
      return `/admin/api/v1/incidents${qs ? `?${qs}` : ''}`;
    },
    create: '/admin/api/v1/incidents',
    update: (id: string) => `/admin/api/v1/incidents/${encodeURIComponent(id)}`,
  },
  // SLA policy (19d) — HEAD_OFFICE + SUPER_ADMIN. GET current, PUT to replace.
  slaPolicy: '/admin/api/v1/sla-policy',
  // Retention windows + read-only backup status (19e) — SUPER_ADMIN. GET list+backup, PUT one row.
  retention: {
    list: '/admin/api/v1/retention',
    update: (id: string) => `/admin/api/v1/retention/${encodeURIComponent(id)}`,
    // Retention enforcement: runs the policy for datasets that have an executor and
    // names the ones that still have none.
    purge: (dryRun = false) => `/admin/api/v1/retention/purge${dryRun ? '?dryRun=true' : ''}`,
  },
  // Security policy (19b) — SUPER_ADMIN. GET current, PUT to replace. (Sessions live in auth-service.)
  security: '/admin/api/v1/security-policy',
  // Per-admin notification prefs (23a) — HEAD_OFFICE + SUPER_ADMIN, own prefs. GET/PUT.
  notifPrefs: '/admin/api/v1/notification-prefs',
  // First-run onboarding wizard state (23b) — SUPER_ADMIN. GET, PATCH one step.
  wizard: '/admin/api/v1/onboarding',
},

// HQ franchise-application approvals queue (depot-service, HEAD_OFFICE/SUPER_ADMIN),
// plus the one public route: a prospective partner submitting an application.
franchiseApps: {
  // Public (no token) and throttled to 3/hour per IP by depot-service.
  submit: '/depots/api/v1/franchise-applications',
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

// HQ console. The network overview reuses the real executive dashboard endpoint;
// the per-depot roll-up (revenue + real SLA + low stock for every depot) is served
// by dashboard-service GET /dashboard/network. Global search assembles client-side
// from the existing per-service list endpoints (depots.manage / auth.staff /
// orders.manage); a dedicated /search endpoint is a later milestone.
hq: {
  overview: (q: { from?: string; to?: string } = {}) => insight.dashboard.executive(q),
  rollup: (q: { from?: string; to?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    const qs = p.toString();
    return `/dashboard/api/v1/dashboard/network${qs ? `?${qs}` : ''}`;
  },
  // New-customer signups in a window (auth-service; head-office/super-admin) → { count }.
  newCustomers: (q: { from?: string; to?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    const qs = p.toString();
    return `/auth/api/v1/auth/customers/count${qs ? `?${qs}` : ''}`;
  },
},
} as const;
