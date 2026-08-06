/** DI tokens for application ports. */
export const CUSTOMER_TOKENS = {
  ProfileRepository: Symbol('ProfileRepository'),
  AddressRepository: Symbol('AddressRepository'),
  PaymentMethodRepository: Symbol('PaymentMethodRepository'),
  NotificationPreferenceRepository: Symbol('NotificationPreferenceRepository'),
  LoyaltyRewardPort: Symbol('LoyaltyRewardPort'),
  DepotCrmRepository: Symbol('DepotCrmRepository'),
  OrderCrmPort: Symbol('OrderCrmPort'),
  DepotLedgerPort: Symbol('DepotLedgerPort'),
  FavoriteRepository: Symbol('FavoriteRepository'),
  ProductCatalogPort: Symbol('ProductCatalogPort'),
  ResellerRepository: Symbol('ResellerRepository'),
  IdentityPort: Symbol('IdentityPort'),
  PdpRepository: Symbol('PdpRepository'),
} as const;
