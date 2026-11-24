export const PAYMENT_TOKENS = {
  PaymentRepository: Symbol('PaymentRepository'),
  PaymentGateway: Symbol('PaymentGateway'),
  OrderCoordination: Symbol('OrderCoordination'),
  TaxSettingsRepository: Symbol('TaxSettingsRepository'),
  Storage: Symbol('Storage'),
  FeatureFlags: Symbol('FeatureFlags'),
  // Flow 6b: a refund queued for HQ, to the accounts that may decide it (via crm).
  RefundAlert: Symbol('RefundAlert'),
  /** HD-11: the count behind the AI web's "waiting for your decision". */
  PendingApprovalsReader: Symbol('PendingApprovalsReader'),
} as const;
