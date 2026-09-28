export const DEPOT_TOKENS = {
  // CA-2-54: stock moving between two depots, in two steps.
  StockTransferRepository: Symbol('StockTransferRepository'),
  DepotRepository: Symbol('DepotRepository'),
  AccountNames: Symbol('AccountNameResolver'),
  InventoryRepository: Symbol('InventoryRepository'),
  LowStockAlert: Symbol('LowStockAlert'),
  /** CA-2-58: head office's complaint queue. */
  HqComplaint: Symbol('HqComplaint'),
  UntrackedSaleAlert: Symbol('UntrackedSaleAlert'),
  ProductCatalog: Symbol('ProductCatalog'),
  PricingRuleRepository: Symbol('PricingRuleRepository'),
  GallonReturnRepository: Symbol('GallonReturnRepository'),
  GallonIssueRepository: Symbol('GallonIssueRepository'),
  /** When each overdue customer was last asked to return their gallons. */
  GallonReminderRepository: Symbol('GallonReminderRepository'),
  /** Name + phone of one customer, from customer-service. */
  CustomerContact: Symbol('CustomerContact'),
  /** Customer-facing messages through crm-service; reports whether crm accepted. */
  CustomerNotification: Symbol('CustomerNotification'),
  FranchiseApplicationRepository: Symbol('FranchiseApplicationRepository'),
  PriceOverrideProposalRepository: Symbol('PriceOverrideProposalRepository'),
  IncidentRepository: Symbol('IncidentRepository'),
  ApprovalRepository: Symbol('ApprovalRepository'),
  SupplierRepository: Symbol('SupplierRepository'),
  PurchaseOrderRepository: Symbol('PurchaseOrderRepository'),
  RosterRepository: Symbol('RosterRepository'),
  DepotTargetRepository: Symbol('DepotTargetRepository'),
  CashbookRepository: Symbol('CashbookRepository'),
  CashierShiftRepository: Symbol('CashierShiftRepository'),
  DepotCash: Symbol('DepotCash'),
  DisputeRepository: Symbol('DisputeRepository'),
  /** CA-2-39: queues the refund a dispute resolution asks for. Fails CLOSED. */
  DisputeRefund: Symbol('DisputeRefund'),
  MaintenanceRepository: Symbol('MaintenanceRepository'),
  WholesaleTierRepository: Symbol('WholesaleTierRepository'),
  SubscriptionRepository: Symbol('SubscriptionRepository'),
  OrderSubscriptionPort: Symbol('OrderSubscriptionPort'),
  HuddleRepository: Symbol('HuddleRepository'),
  HandoverRepository: Symbol('HandoverRepository'),
  OperationalReportRepository: Symbol('OperationalReportRepository'),
  Storage: Symbol('Storage'),
} as const;
