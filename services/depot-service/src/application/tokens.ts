export const DEPOT_TOKENS = {
  DepotRepository: Symbol('DepotRepository'),
  InventoryRepository: Symbol('InventoryRepository'),
  LowStockAlert: Symbol('LowStockAlert'),
  PricingRuleRepository: Symbol('PricingRuleRepository'),
  GallonReturnRepository: Symbol('GallonReturnRepository'),
  GallonIssueRepository: Symbol('GallonIssueRepository'),
  FranchiseApplicationRepository: Symbol('FranchiseApplicationRepository'),
} as const;
