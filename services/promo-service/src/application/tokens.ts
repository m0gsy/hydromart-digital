export const PROMO_TOKENS = {
  VoucherRepository: Symbol('VoucherRepository'),
  PromotionRepository: Symbol('PromotionRepository'),
  PromoRuleRepository: Symbol('PromoRuleRepository'),
  OrderValues: Symbol('OrderValues'),
  /** HD-14: depots on a quality hold (depot-service). */
  HeldDepots: Symbol('HeldDepots'),
  CustomerLookup: Symbol('CustomerLookup'),
  Notification: Symbol('Notification'),
  AccountNames: Symbol('AccountNameResolver'),
  Storage: Symbol('StoragePort'),
} as const;
