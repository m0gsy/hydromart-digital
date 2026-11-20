export interface RefundRequestedAlert {
  paymentId: string;
  depotId: string | null;
  amount: number;
}

/**
 * Flow 6b (plan PR-6): a refund above the HQ threshold waits in the refund queue; crm wakes the
 * accounts holding `refundQueue`. Never throws: the request is already stored.
 */
export interface RefundAlertPort {
  requested(alert: RefundRequestedAlert): Promise<void>;
}
