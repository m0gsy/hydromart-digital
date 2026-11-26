export const PAYOUT_TOKENS = {
  LedgerRepository: Symbol('LedgerRepository'),
  WithdrawalRepository: Symbol('WithdrawalRepository'),
  CommissionSchemeRepository: Symbol('CommissionSchemeRepository'),
  CourierLedgerRepository: Symbol('CourierLedgerRepository'),
  CourierWithdrawalRepository: Symbol('CourierWithdrawalRepository'),
  ExpenseClaimRepository: Symbol('ExpenseClaimRepository'),
  PhotoLink: Symbol('PhotoLink'),
  // Flow 6b: a claim waiting for a reviewer, to the accounts that may decide it (via crm).
  ExpenseClaimAlert: Symbol('ExpenseClaimAlert'),
  ReleaseRequestRepository: Symbol('ReleaseRequestRepository'),
  BankAccountRepository: Symbol('BankAccountRepository'),
  /** HD-11: the count behind the AI web's "waiting for your decision". */
  PendingApprovalsReader: Symbol('PendingApprovalsReader'),
  /** HD-23: the monthly partner bill, what it reads from depot-service and tells crm-service. */
  PartnerBillRepository: Symbol('PartnerBillRepository'),
  PartnerBillSources: Symbol('PartnerBillSources'),
  PartnerBillNotifier: Symbol('PartnerBillNotifier'),
} as const;
