export interface ExpenseClaimAlert {
  claimId: string;
  depotId: string | null;
  amount: number;
  category: string;
}

/**
 * Flow 6b (plan PR-6): a claim that did not approve itself waits for a reviewer; crm wakes the
 * accounts holding `expenseApprove`. Never throws: the claim is already stored.
 */
export interface ExpenseClaimAlertPort {
  submitted(alert: ExpenseClaimAlert): Promise<void>;
}
