export const DASHBOARD_TOKENS = {
  Sources: Symbol('DashboardSources'),
  AccountNames: Symbol('AccountNameResolver'),
  /** HD-11: each decision queue's count, from the service that holds it. */
  PendingApprovalSources: Symbol('PendingApprovalSources'),
  /** HD-6: depot-service's legal-entity facts for the AI read API's scope narrowing. */
  AiReadSources: Symbol('AiReadSources'),
} as const;
