export const DASHBOARD_TOKENS = {
  Sources: Symbol('DashboardSources'),
  AccountNames: Symbol('AccountNameResolver'),
  /** HD-11: each decision queue's count, from the service that holds it. */
  PendingApprovalSources: Symbol('PendingApprovalSources'),
  /** HD-6: depot-service's legal-entity facts for the AI read API's scope narrowing. */
  AiReadSources: Symbol('AiReadSources'),
  /** HD-6 H2: the money facts (sales, cash, COD, cashbook) the AI read API reads beside the P&L. */
  AiMoneySources: Symbol('AiMoneySources'),
  /** HD-6 H4: the stock, meter and forecast facts the AI read API reads. */
  AiStockSources: Symbol('AiStockSources'),
  /** HD-6 H4 part 2: the loyalty, referral, promo-cost, subscription, campaign and open-queue facts the AI read API reads. */
  AiLoyaltySources: Symbol('AiLoyaltySources'),
  /** HD-6 H5: the franchise, legal-entity, HR and commission facts the AI read API reads. */
  AiOrgSources: Symbol('AiOrgSources'),
  /** HD-6 H3: the customer, delivery and gallon facts the AI read API reads. */
  AiCustomerSources: Symbol('AiCustomerSources'),
  /** HD-20c: the pins, regions and unserved demand behind the areas read. */
  AiAreaSources: Symbol('AiAreaSources'),
  /** AREA-3: the grouped B2B prospect counts behind the prospects read. */
  AiProspectSources: Symbol('AiProspectSources'),
  /** AI-21: the supervisor-visit counts behind the visits read. */
  AiVisitSources: Symbol('AiVisitSources'),
} as const;
