/** DI tokens for application ports. */
export const CUSTOMER_TOKENS = {
  ProfileRepository: Symbol('ProfileRepository'),
  AddressRepository: Symbol('AddressRepository'),
  PaymentMethodRepository: Symbol('PaymentMethodRepository'),
  NotificationPreferenceRepository: Symbol('NotificationPreferenceRepository'),
  LoyaltyRewardPort: Symbol('LoyaltyRewardPort'),
  DepotCrmRepository: Symbol('DepotCrmRepository'),
  OrderCrmPort: Symbol('OrderCrmPort'),
  FavoriteRepository: Symbol('FavoriteRepository'),
  ProductCatalogPort: Symbol('ProductCatalogPort'),
  ResellerRepository: Symbol('ResellerRepository'),
} as const;
