export const DASHBOARD_TOKENS = {
  Sources: Symbol('DashboardSources'),
  AccountNames: Symbol('AccountNameResolver'),
  /** HD-11: each decision queue's count, from the service that holds it. */
  PendingApprovalSources: Symbol('PendingApprovalSources'),
} as const;
