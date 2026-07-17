export const PAYMENT_TOKENS = {
  PaymentRepository: Symbol('PaymentRepository'),
  PaymentGateway: Symbol('PaymentGateway'),
  OrderCoordination: Symbol('OrderCoordination'),
  TaxSettingsRepository: Symbol('TaxSettingsRepository'),
} as const;
