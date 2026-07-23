export interface OrderValue {
  orderId: string;
  totalIdr: number;
}

/** Null means the order-service value source was unavailable or incomplete. */
export interface OrderValuePort {
  findOrderValues(orderIds: string[]): Promise<OrderValue[] | null>;
}
