export const PAYMENT_TOKENS = {
  PaymentRepository: Symbol('PaymentRepository'),
  PaymentGateway: Symbol('PaymentGateway'),
  OrderCoordination: Symbol('OrderCoordination'),
  TaxSettingsRepository: Symbol('TaxSettingsRepository'),
  Storage: Symbol('Storage'),
} as const;
