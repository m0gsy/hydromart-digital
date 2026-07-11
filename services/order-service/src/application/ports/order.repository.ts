import { OrderStatus } from '../../domain/order-status';

export interface OrderItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderStatusHistoryRecord {
  status: OrderStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: Date;
}

export interface DeliveryAddressSnapshot {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface OrderRecord extends DeliveryAddressSnapshot {
  id: string;
  orderNumber: string;
  customerId: string;
  depotId: string | null;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: OrderItemRecord[];
  history: OrderStatusHistoryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderItemData {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface CreateOrderData extends DeliveryAddressSnapshot {
  /** Pre-generated id so stock can be reserved (keyed by order id) before the row is created. */
  id?: string;
  orderNumber: string;
  customerId: string;
  depotId: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: CreateOrderItemData[];
}

export interface OrderQuery {
  customerId?: string;
  status?: OrderStatus;
  page: number;
  limit: number;
}

/** Reporting window. Both bounds optional; open-ended when absent. */
export interface ReportRange {
  from?: Date;
  to?: Date;
}

export interface SalesBucket {
  /** YYYY-MM-DD for daily granularity, YYYY-MM for monthly. */
  period: string;
  orderCount: number;
  revenue: number;
}

export interface CustomerSales {
  customerId: string;
  orderCount: number;
  revenue: number;
}

export interface DepotSales {
  depotId: string;
  orderCount: number;
  revenue: number;
}

export interface OrderRepository {
  create(data: CreateOrderData): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  search(query: OrderQuery): Promise<{ items: OrderRecord[]; total: number }>;
  /** CREATED orders placed before `before` — unconfirmed, treated as abandoned. */
  findStaleCreated(before: Date): Promise<OrderRecord[]>;
  /**
   * Keyset-paginated COMPLETED orders ordered by (createdAt asc, id asc), for the
   * recommendation-service rebuild feed. `cursor` is opaque (the id of the first
   * not-yet-returned row from a prior page) — `null` starts from the beginning.
   * `nextCursor` is the id of the row just past `limit`, or `null` on the last page.
   */
  findCompletedPage(
    cursor: string | null,
    limit: number,
  ): Promise<{ orders: OrderRecord[]; nextCursor: string | null }>;
  /** Atomically move the order to `status` and append a history row. */
  applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
  ): Promise<OrderRecord>;
  /** Revenue/order counts bucketed by day or month (CANCELLED excluded). FR-095/096. */
  salesSeries(granularity: 'daily' | 'monthly', range: ReportRange): Promise<SalesBucket[]>;
  /** Highest-spending customers in the window (CANCELLED excluded). FR-097. */
  topCustomers(range: ReportRange, limit: number): Promise<CustomerSales[]>;
  /** Highest-revenue depots in the window (null depot & CANCELLED excluded). FR-098. */
  topDepots(range: ReportRange, limit: number): Promise<DepotSales[]>;
}
