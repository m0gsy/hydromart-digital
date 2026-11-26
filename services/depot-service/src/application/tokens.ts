export const DEPOT_TOKENS = {
  // DEP-10: what is still in flight against a depot being switched off.
  DeactivationProbe: Symbol('DepotDeactivationProbe'),
  // CA-2-54: stock moving between two depots, in two steps.
  StockTransferRepository: Symbol('StockTransferRepository'),
  DepotRepository: Symbol('DepotRepository'),
  AccountNames: Symbol('AccountNameResolver'),
  InventoryRepository: Symbol('InventoryRepository'),
  LowStockAlert: Symbol('LowStockAlert'),
  // Flow 6b: price changes proposed, to the accounts that may decide them.
  PriceOverrideAlert: Symbol('PriceOverrideAlert'),
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
  /** Role of each account in a set, from auth-service (who in a chain can decide an approval). */
  AccountRoles: Symbol('AccountRoles'),
  FranchiseApplicationRepository: Symbol('FranchiseApplicationRepository'),
  PriceOverrideProposalRepository: Symbol('PriceOverrideProposalRepository'),
  IncidentRepository: Symbol('IncidentRepository'),
  ApprovalRepository: Symbol('ApprovalRepository'),
  /** HD-11: the counts behind the AI web's "waiting for your decision". */
  PendingApprovalsReader: Symbol('PendingApprovalsReader'),
  SupplierRepository: Symbol('SupplierRepository'),
  /** HD-5: legal entities, their dated depots and the AI-web matrix. */
  LegalEntityRepository: Symbol('LegalEntityRepository'),
  PurchaseOrderRepository: Symbol('PurchaseOrderRepository'),
  RosterRepository: Symbol('RosterRepository'),
  DepotTargetRepository: Symbol('DepotTargetRepository'),
  /** HD-16: fixed costs per depot, month and category. */
  DepotFixedCostRepository: Symbol('DepotFixedCostRepository'),
  CashbookRepository: Symbol('CashbookRepository'),
  CashierShiftRepository: Symbol('CashierShiftRepository'),
  DepotCash: Symbol('DepotCash'),
  DisputeRepository: Symbol('DisputeRepository'),
  /** CA-2-39: queues the refund a dispute resolution asks for. Fails CLOSED. */
  DisputeRefund: Symbol('DisputeRefund'),
  MaintenanceRepository: Symbol('MaintenanceRepository'),
  /** HD-14: quality holds, lab tests and permits. */
  QualityHoldRepository: Symbol('QualityHoldRepository'),
  WholesaleTierRepository: Symbol('WholesaleTierRepository'),
  SubscriptionRepository: Symbol('SubscriptionRepository'),
  OrderSubscriptionPort: Symbol('OrderSubscriptionPort'),
  OrderLedger: Symbol('OrderLedger'),
  /** HD-15: water through a depot's meter over a range (order-service), for volume-based maintenance. */
  MeterVolume: Symbol('MeterVolume'),
  HuddleRepository: Symbol('HuddleRepository'),
  /** HD-15B: supervisor visit checklist templates, and hr-service's SOP-in-force lookup. */
  VisitTemplateRepository: Symbol('VisitTemplateRepository'),
  DepotDraftRepository: Symbol('DepotDraftRepository'),
  SopLookup: Symbol('SopLookup'),
  /** HD-15B PR-4: supervisor visits and the private bucket their finding photos live in. */
  VisitRepository: Symbol('VisitRepository'),
  VisitPhotoStorage: Symbol('VisitPhotoStorage'),
  /** HD-15B PR-6: crm-service's visit notices (findings, overdue follow-ups). */
  VisitNotifier: Symbol('VisitNotifier'),
  HandoverRepository: Symbol('HandoverRepository'),
  OperationalReportRepository: Symbol('OperationalReportRepository'),
  Storage: Symbol('Storage'),
  /** HD-7: webhook events owed to admin-service, and the transport that hands them over. */
  EventOutbox: Symbol('EventOutbox'),
  EventTransport: Symbol('EventTransport'),
} as const;
