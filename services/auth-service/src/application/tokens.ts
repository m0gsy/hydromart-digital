/**
 * Dependency-injection tokens for the application ports. Using symbols keeps the
 * binding explicit and avoids coupling providers to concrete class names.
 */
export const AUTH_TOKENS = {
  CustomerRepository: Symbol('CustomerRepository'),
  OtpTokenRepository: Symbol('OtpTokenRepository'),
  RefreshTokenRepository: Symbol('RefreshTokenRepository'),
  AuditLogRepository: Symbol('AuditLogRepository'),
  OtpDeliveryPort: Symbol('OtpDeliveryPort'),
  CryptoPort: Symbol('CryptoPort'),
  AccessTokenSignerPort: Symbol('AccessTokenSignerPort'),
  GoogleVerifierPort: Symbol('GoogleVerifierPort'),
  ClockPort: Symbol('ClockPort'),
} as const;
