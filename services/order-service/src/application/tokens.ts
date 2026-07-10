export const ORDER_TOKENS = {
  CartRepository: Symbol('CartRepository'),
  OrderRepository: Symbol('OrderRepository'),
  ProductCatalog: Symbol('ProductCatalog'),
  DepotDirectory: Symbol('DepotDirectory'),
  LoyaltyCoordination: Symbol('LoyaltyCoordination'),
  ReferralCoordination: Symbol('ReferralCoordination'),
  Membership: Symbol('Membership'),
  Notification: Symbol('Notification'),
  Promo: Symbol('Promo'),
} as const;
