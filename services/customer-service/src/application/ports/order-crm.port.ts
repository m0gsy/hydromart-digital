/** One customer's order aggregate at a depot, from order-service (Fase 4 CRM). */
export interface DepotCustomerOrderStats {
  customerId: string;
  name: string | null;
  phone: string | null;
  orderCount: number;
  totalSpent: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

/**
 * Reads per-customer order aggregates for a depot's CRM lifecycle. Implemented by an
 * HTTP adapter to order-service's internal endpoint; fails SOFT (→ [] on any error /
 * missing config) so the CRM screens degrade to "no order data yet" rather than erroring.
 */
/** One order on the CRM detail screen's "Pesanan terakhir" list. */
export interface DepotCustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalIdr: number;
  placedAt: string;
}

export interface OrderCrmPort {
  depotCustomerStats(depotId: string): Promise<DepotCustomerOrderStats[]>;
  /** One customer's recent orders at this depot; [] on any failure, like the aggregate above. */
  customerOrders(depotId: string, customerId: string): Promise<DepotCustomerOrder[]>;
}
