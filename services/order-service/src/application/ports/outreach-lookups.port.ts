/** HD-18: the account behind a phone number, read without creating one (auth-service). THROWS when it cannot answer. */
export interface AccountByPhonePort {
  customerIdByPhone(phone: string): Promise<string | null>;
}

export interface OrderPaymentRow {
  orderId: string;
  method: string;
  status: string;
}

/** HD-18: the newest payment of each order (payment-service). THROWS when it cannot answer. */
export interface PaymentsOfOrdersPort {
  latestByOrder(orderIds: string[]): Promise<Map<string, OrderPaymentRow>>;
}
