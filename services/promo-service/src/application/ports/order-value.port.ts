export interface OrderValue {
  orderId: string;
  totalIdr: number;
  /** The order's depot, null while unassigned. PRM-2 scopes analytics on it. */
  depotId: string | null;
}

/** Null means the order-service value source was unavailable or incomplete. */
export interface OrderValuePort {
  findOrderValues(orderIds: string[]): Promise<OrderValue[] | null>;
}
