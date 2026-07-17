export const DEPOT_TOKENS = {
  DepotRepository: Symbol('DepotRepository'),
  InventoryRepository: Symbol('InventoryRepository'),
  LowStockAlert: Symbol('LowStockAlert'),
  PricingRuleRepository: Symbol('PricingRuleRepository'),
  GallonReturnRepository: Symbol('GallonReturnRepository'),
  GallonIssueRepository: Symbol('GallonIssueRepository'),
  FranchiseApplicationRepository: Symbol('FranchiseApplicationRepository'),
  PriceOverrideProposalRepository: Symbol('PriceOverrideProposalRepository'),
  IncidentRepository: Symbol('IncidentRepository'),
  ApprovalRepository: Symbol('ApprovalRepository'),
  SupplierRepository: Symbol('SupplierRepository'),
  PurchaseOrderRepository: Symbol('PurchaseOrderRepository'),
} as const;
