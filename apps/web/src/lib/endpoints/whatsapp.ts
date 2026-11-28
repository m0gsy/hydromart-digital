// WhatsApp number 1 (crm-service, HD-12/HD-13). Full path literals on purpose: the endpoint-contract and
// route-parity scripts read them to prove every builder has a controller route and every route a caller.
export const whatsapp = {
  whatsapp: {
    // Any signed-in account: is the channel on? Every screen below hides itself when it is not.
    status: '/crm/api/v1/whatsapp/status',
    // The customer's own code (SELF), their state, and the withdrawal.
    selfCode: '/crm/api/v1/whatsapp/opt-in/code',
    me: '/crm/api/v1/whatsapp/me',
    revoke: '/crm/api/v1/whatsapp/me/revoke',
    // The cashier's walk-in code and its polled state (waOptInIssue).
    cashierCode: '/crm/api/v1/whatsapp/opt-in/codes',
    codeState: (id: string) => `/crm/api/v1/whatsapp/opt-in/codes/${encodeURIComponent(id)}`,
    // Depot CRM follow-up list (depotCrm): OPTED_IN / STOPPED / NONE per customer id.
    contactState: '/crm/api/v1/whatsapp/contact-state',
    // HQ (waCostRead reads, waManage writes).
    hqOverview: '/crm/api/v1/whatsapp/hq/overview',
    hqCap: (category: string) => `/crm/api/v1/whatsapp/hq/caps/${encodeURIComponent(category)}`,
    hqPause: '/crm/api/v1/whatsapp/hq/pause',
    hqTemplates: '/crm/api/v1/whatsapp/hq/templates',
  },
} as const;
