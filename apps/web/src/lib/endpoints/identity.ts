// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

export const identity = {
auth: {
  register: '/auth/api/v1/auth/register',
  verifyOtp: '/auth/api/v1/auth/otp/verify',
  resendOtp: '/auth/api/v1/auth/otp/resend',
  login: '/auth/api/v1/auth/login',
  refresh: '/auth/api/v1/auth/token/refresh',
  me: '/auth/api/v1/auth/me',
  // PATCH: update own name/email.
  updateProfile: '/auth/api/v1/auth/me',
  // Multipart avatar-photo upload (self); returns the updated customer.
  uploadAvatar: '/auth/api/v1/auth/me/avatar',
  // K1.4, the two halves of changing the login identity. `requestPhoneChange` sends a code
  // to the NEW number; `confirmPhoneChange` spends it and moves the account. The confirm
  // body carries only the code — the destination is read off the stored challenge, so a
  // proof of one number can never move the account onto another.
  requestPhoneChange: '/auth/api/v1/auth/me/phone',
  confirmPhoneChange: '/auth/api/v1/auth/me/phone/confirm',
  // Staff: resolve a phone to a customer (for voucher grant). 404 if none.
  customerLookup: (phone: string) =>
    `/auth/api/v1/auth/customers/lookup?phone=${encodeURIComponent(phone)}`,
  // Staff: resolve customer ids → public profiles (reseller row-name labels). Array of Customer.
  customersByIds: (ids: string[]) =>
    `/auth/api/v1/auth/customers/by-ids?ids=${encodeURIComponent(ids.join(','))}`,
  logout: '/auth/api/v1/auth/logout',
  // PAR-16: revoke EVERY session at once. Built with the sessions list, and until the
  // devices sheet in /account there was no screen anywhere that could call it — so the one
  // thing a customer needs the moment their phone is stolen was unreachable.
  logoutAll: '/auth/api/v1/auth/logout/all',
  // RBAC matrix (F2): read the effective map, retune or reset one capability. Writes
  // are accessMatrixWrite (super-admin by default) and reach the guards within a TTL.
  matrix: '/auth/api/v1/access/matrix',
  capability: (name: string) => `/auth/api/v1/access/matrix/${encodeURIComponent(name)}`,
  // Current user's active device sessions (19b) + revoke one by id.
  sessions: '/auth/api/v1/sessions',
  revokeSession: (id: string) => `/auth/api/v1/sessions/${encodeURIComponent(id)}/revoke`,
  // Staff & roles directory (head-office/super-admin). List is paginated → { items, ... }.
  staff: (
    q: { page?: number; limit?: number; role?: string; depotId?: string; search?: string } = {},
  ) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    if (q.role) p.set('role', q.role);
    if (q.depotId) p.set('depotId', q.depotId);
    // Audit F-12: name/phone substring, matched by auth-service over the whole directory.
    if (q.search) p.set('search', q.search);
    const qs = p.toString();
    return `/auth/api/v1/auth/staff${qs ? `?${qs}` : ''}`;
  },
  inviteStaff: '/auth/api/v1/auth/staff/invite',
  // Bulk form of the line above: one POST for the whole spreadsheet, with a per-row
  // verdict back, instead of the console firing N invites and counting them itself.
  importStaff: '/auth/api/v1/auth/staff/import',
  // Move an existing staff account to another depot (PATCH, staffAdmin). Not the invite:
  // re-inviting the same phone was the old way, and it re-roled them on the way past.
  setStaffDepot: (id: string) => `/auth/api/v1/auth/staff/${id}/depot`,
  // PATCH { active }: suspends or restores the login AND their HR record (staffAdmin).
  setStaffActive: (id: string) => `/auth/api/v1/auth/staff/${id}/status`,
  // DELETE: anonymises the identity across services and closes the login for good
  // (staffDelete = SUPER_ADMIN). Irreversible.
  deleteStaff: (id: string) => `/auth/api/v1/auth/staff/${id}`,
  // Active STAFF_DEPOT roster for dispatch (courier assignment). Array of Customer.
  drivers: '/auth/api/v1/auth/drivers',
},

// The signed-in customer's own profile: membership tier, point balance, and
// `favoriteDepotId` — the depot their orders route to, which is how the help screen
// knows whose phone number to show.
profile: {
  me: '/customers/api/v1/profile',
  // I5: my gallons still on loan and my deposit still held, per depot. Both numbers
  // existed only in the staff console before this — the person whose money it is had no
  // screen for either.
  gallonDeposit: '/customers/api/v1/profile/gallon-deposit',
},

// Notification channel preferences (GET to read, PATCH to update).
preferences: {
  notifications: '/customers/api/v1/profile/notifications',
},

// Customer's notification inbox feed (crm-service, newest first).
notifications: {
  me: '/crm/api/v1/notifications/me',
  // Staff operational feed: recent ops alerts (low stock, …), each with the caller's
  // own read receipt. Reads are per staff member and persist server-side.
  ops: '/crm/api/v1/notifications/ops',
  opsRead: (id: string) => `/crm/api/v1/notifications/ops/${id}/read`,
  opsReadAll: '/crm/api/v1/notifications/ops/read-all',
},

// Web Push (crm-service, design 7b transport). vapidKey → browser subscribe; subscribe/
// unsubscribe register a device endpoint (DELETE takes { endpoint } in the body).
push: {
  vapidKey: '/crm/api/v1/push/vapid-public-key',
  subscribe: '/crm/api/v1/push/subscriptions',
  unsubscribe: '/crm/api/v1/push/subscriptions',
},

// Depot broadcasts (design 8a). Courier lists their depot's announcements + marks read;
// depot ops (depotBroadcast cap) posts via POST.
broadcasts: {
  forDepot: (depotId: string) => `/crm/api/v1/broadcasts?depotId=${encodeURIComponent(depotId)}`,
  create: '/crm/api/v1/broadcasts',
  read: (id: string) => `/crm/api/v1/broadcasts/${id}/read`,
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

favorites: {
  // Wishlist (customer-service, via the `customers` gateway segment). GET returns
  // { productIds }, POST { productId } adds (idempotent), DELETE removes.
  list: '/customers/api/v1/favorites',
  add: '/customers/api/v1/favorites',
  remove: (productId: string) => `/customers/api/v1/favorites/${productId}`,
},

// UU PDP tahap 1 (item 13): the data-subject request queue lives in auth-service.
pdp: {
  request: '/auth/api/v1/account/data-requests',
  mine: '/auth/api/v1/account/data-requests/me',
  myExport: '/auth/api/v1/account/data-requests/me/export',
  queue: (status?: string) =>
    `/auth/api/v1/account/data-requests${status ? `?status=${status}` : ''}`,
  approve: (id: string) => `/auth/api/v1/account/data-requests/${id}/approve`,
  // UU PDP tahap 2 — the consent ledger.
  consents: '/auth/api/v1/account/consents',
  /*
   * Every consent decision the person has made, oldest first — built for UU PDP and
   * reachable from no screen, so the one thing the law is about ("what did I agree to, and
   * when") could be answered by the server and not by the app.
   */
  consentHistory: '/auth/api/v1/account/consents/history',
  // (consentHistory removed, audit F: the consent LEDGER is written and read by the purge
  // engine, but no screen has ever shown a customer their own consent history. The route
  // stays live in auth-service; this table lists what the app calls.)
  /*
   * W10 — "is there anything I still have to accept?", asked by the account it is about
   * and never on behalf of another. auth-service could work this out from the day the
   * ledger shipped and no route returned it; then the route landed and no screen called
   * it, which is the same hole one step along. Read on the consent sheet in /account,
   * beside the PUT that answers it — there is no second write path.
   *
   * `enforcement: 'UNENFORCED'` is part of the contract, not a footnote: nothing on the
   * server blocks, downgrades or signs out an account over this answer, so nothing on the
   * screen may either.
   */
  consentPending: '/auth/api/v1/account/consents/pending',
  /*
   * The fleet-wide half of the same question, behind `pdpRequests` (the PDP desk) rather
   * than `hqConsole` (a director). Keyset-paginated, and the server caps a page at 100:
   * this walks the whole customer base, so the caller carries a cursor instead of asking
   * for all of it and rendering a list with no end.
   */
  /*
   * ONE LINE, and that is load-bearing rather than a style choice:
   * check-endpoint-contracts.mjs resolves `endpoints.<a>.<b>` with a regex that wants the
   * property name and its path literal on the SAME line, so anything wrapped is unreadable
   * and lands in the unresolvable-call-site ratchet. Written wrapped it pushed that count
   * 258 -> 259 and failed the build — correctly: an unresolvable call is one where nothing
   * verifies the client and the controller agree on the verb. (`queue` above is wrapped and
   * is one of the 258; this one does not need to join it.)
   */
  consentReport: (q: { limit?: number; cursor?: string } = {}) => `/auth/api/v1/account/consents/report?limit=${q.limit ?? ''}${q.cursor ? `&cursor=${encodeURIComponent(q.cursor)}` : ''}`,
  reject: (id: string) => `/auth/api/v1/account/data-requests/${id}/reject`,
},
} as const;
